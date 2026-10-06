package kr.masscom.navermap

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.content.ComponentCallbacks2
import android.widget.FrameLayout
import com.naver.maps.geometry.LatLng
import com.naver.maps.map.CameraPosition
import com.naver.maps.map.NaverMap
import com.naver.maps.map.NaverMapSdk
import com.naver.maps.map.MapView
import com.naver.maps.map.overlay.Marker
import com.naver.maps.map.overlay.PathOverlay
import com.naver.maps.map.util.MarkerIcons
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.abs

class NaverMapModule : Module() {
  private val views = mutableSetOf<NaverView>()
  private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("MasscomNaverMap")
    OnActivityEntersForeground { foreground = true; views.forEach { it.syncRunning(true) } }
    OnActivityEntersBackground { foreground = false; views.forEach { it.syncRunning(false) } }
    View(NaverView::class) {
      Events("onReady", "onError", "onViewport", "onSelect", "onCluster")
      Prop("clientId") { view: NaverView, id: String -> view.setClientId(id) }
      Prop("camera") { view: NaverView, camera: Map<String, Double> -> view.setCamera(camera) }
      Prop("markers") { view: NaverView, markers: List<Map<String, Any>> -> view.setMarkers(markers) }
      Prop("selectedId") { view: NaverView, id: String? -> view.setSelection(id) }
      Prop("route") { view: NaverView, route: Map<String, Any>? -> view.setRoute(route) }
      Prop("padding") { view: NaverView, padding: Map<String, Int> -> view.setPadding(padding) }
      Prop("active") { view: NaverView, active: Boolean -> view.active = active; view.syncRunning(foreground) }
      OnViewDidUpdateProps { view -> views.add(view); view.syncRunning(foreground) }
      OnViewDestroys { view -> views.remove(view); view.dispose() }
    }
  }
}

class NaverView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onReady by EventDispatcher()
  private val onError by EventDispatcher()
  private val onViewport by EventDispatcher()
  private val onSelect by EventDispatcher()
  private val onCluster by EventDispatcher()
  private var mapView: MapView? = null
  private var naverMap: NaverMap? = null
  private var started = false
  private var disposed = false
  var active = false
  private var camera: Map<String, Double>? = null
  private var markerRows: List<Map<String, Any>> = emptyList()
  private var selectedId: String? = null
  private var routeData: Map<String, Any>? = null
  private var paddingData: Map<String, Int> = emptyMap()
  private val markerOverlays = mutableListOf<Marker>()
  private val pathOverlays = mutableListOf<PathOverlay>()
  private var authListener: NaverMapSdk.OnAuthFailedListener? = null
  private val memoryCallbacks = object : ComponentCallbacks2 {
    override fun onLowMemory() { mapView?.onLowMemory() }
    override fun onTrimMemory(level: Int) { onLowMemory() }
    override fun onConfigurationChanged(newConfig: Configuration) = Unit
  }

  fun setClientId(id: String) {
    if (disposed || mapView != null || id.isBlank()) return
    try {
      val sdk = NaverMapSdk.getInstance(context.applicationContext)
      sdk.client = NaverMapSdk.NcpKeyClient(id)
      authListener = NaverMapSdk.OnAuthFailedListener {
        if (!disposed) onError(mapOf("code" to "MAP_AUTH_FAILED", "retryable" to false))
      }
      sdk.onAuthFailedListener = authListener
      val view = MapView(context)
      mapView = view
      addView(view, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
      context.applicationContext.registerComponentCallbacks(memoryCallbacks)
      view.onCreate(null)
      view.getMapAsync { map ->
        if (disposed) return@getMapAsync
        naverMap = map
        map.addOnCameraIdleListener { emitViewport() }
        applyPadding()
        applyCamera()
        applyMarkers()
        applyRoute()
        onReady(emptyMap<String, Any>())
        emitViewport()
      }
    } catch (_: Exception) {
      onError(mapOf("code" to "MAP_NATIVE_UNAVAILABLE", "retryable" to true))
    }
  }

  fun setCamera(value: Map<String, Double>) { camera = value; applyCamera() }
  private fun applyCamera() {
    val map = naverMap ?: return
    val c = camera ?: return
    val lat = c["latitude"] ?: return
    val lon = c["longitude"] ?: return
    val zoom = c["zoom"] ?: return
    if (!lat.isFinite() || !lon.isFinite() || !zoom.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return
    val current = map.cameraPosition
    val level = zoom.coerceIn(1.0, 19.0)
    if (abs(current.target.latitude - lat) < 0.000001 && abs(current.target.longitude - lon) < 0.000001 && abs(current.zoom - level) < 0.01) return
    map.cameraPosition = CameraPosition(LatLng(lat, lon), level)
  }

  fun setPadding(value: Map<String, Int>) { paddingData = value; applyPadding() }
  private fun applyPadding() {
    val map = naverMap ?: return
    val density = resources.displayMetrics.density
    fun px(side: String) = ((paddingData[side] ?: 0).coerceAtLeast(0) * density).toInt()
    map.setContentPadding(px("left"), px("top"), px("right"), px("bottom"), true)
  }

  fun setSelection(id: String?) { selectedId = id; applyMarkers() }
  fun setMarkers(value: List<Map<String, Any>>) { markerRows = value; applyMarkers() }
  private fun applyMarkers() {
    val map = naverMap ?: return
    markerOverlays.forEach { it.map = null }
    markerOverlays.clear()
    markerRows.forEach { row ->
      val id = row["id"] as? String ?: return@forEach
      val lat = (row["latitude"] as? Number)?.toDouble() ?: return@forEach
      val lon = (row["longitude"] as? Number)?.toDouble() ?: return@forEach
      if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return@forEach
      val count = (row["count"] as? Number)?.toInt()?.takeIf { it > 0 }
      val marker = Marker(LatLng(lat, lon))
      marker.icon = when {
        count != null -> MarkerIcons.CLUSTER_LOW_DENSITY
        id == selectedId -> MarkerIcons.BLUE
        row["state"] == "complete" -> MarkerIcons.YELLOW
        row["state"] == "visited" -> MarkerIcons.GREEN
        row["state"] == "external" -> MarkerIcons.GRAY
        else -> MarkerIcons.RED
      }
      marker.captionText = count?.toString() ?: (row["title"] as? String).orEmpty()
      marker.setOnClickListener {
        if (count != null) onCluster(mapOf("ids" to listOf(id))) else onSelect(mapOf("id" to id))
        true
      }
      marker.map = map
      markerOverlays.add(marker)
    }
  }

  fun setRoute(value: Map<String, Any>?) { routeData = value; applyRoute() }
  private fun applyRoute() {
    val map = naverMap ?: return
    pathOverlays.forEach { it.map = null }
    pathOverlays.clear()
    val data = routeData ?: return
    if (data["type"] != "MultiLineString") return
    val lines = data["coordinates"] as? List<*> ?: return
    lines.forEach { raw ->
      val points = raw as? List<*> ?: return@forEach
      val coords = points.mapNotNull { pair ->
        val values = pair as? List<*> ?: return@mapNotNull null
        val lon = (values.getOrNull(0) as? Number)?.toDouble() ?: return@mapNotNull null
        val lat = (values.getOrNull(1) as? Number)?.toDouble() ?: return@mapNotNull null
        if (lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0) LatLng(lat, lon) else null
      }
      if (coords.size < 2) return@forEach
      val path = PathOverlay(coords)
      path.color = Color.rgb(42, 112, 178)
      path.width = (5 * resources.displayMetrics.density).toInt().coerceAtLeast(1)
      path.map = map
      pathOverlays.add(path)
    }
  }

  private fun emitViewport() {
    val map = naverMap ?: return
    if (!active || disposed) return
    val bounds = map.contentBounds
    val position = map.cameraPosition
    onViewport(mapOf("bounds" to mapOf("west" to bounds.southWest.longitude, "south" to bounds.southWest.latitude,
      "east" to bounds.northEast.longitude, "north" to bounds.northEast.latitude),
      "camera" to mapOf("latitude" to position.target.latitude, "longitude" to position.target.longitude, "zoom" to position.zoom)))
  }

  fun syncRunning(foreground: Boolean) {
    val view = mapView ?: return
    val shouldRun = active && foreground && !disposed
    if (shouldRun == started) return
    started = shouldRun
    if (shouldRun) { view.onStart(); view.onResume() } else { view.onPause(); view.onStop() }
  }

  fun dispose() {
    if (disposed) return
    if (started) { mapView?.onPause(); mapView?.onStop(); started = false }
    disposed = true
    markerOverlays.forEach { it.map = null }
    pathOverlays.forEach { it.map = null }
    markerOverlays.clear()
    pathOverlays.clear()
    mapView?.onSaveInstanceState(Bundle())
    mapView?.onDestroy()
    mapView?.let { context.applicationContext.unregisterComponentCallbacks(memoryCallbacks) }
    mapView = null
    naverMap = null
    val sdk = NaverMapSdk.getInstance(context.applicationContext)
    if (sdk.onAuthFailedListener === authListener) sdk.onAuthFailedListener = null
    authListener = null
  }
}
