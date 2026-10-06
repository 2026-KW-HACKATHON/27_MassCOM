package kr.masscom.tmapmap

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
import com.skt.tmap.TMapInsets
import com.skt.tmap.TMapPoint
import com.skt.tmap.TMapView
import com.skt.tmap.overlay.TMapCircle
import com.skt.tmap.overlay.TMapMarkerItem
import com.skt.tmap.overlay.TMapPolyLine
import com.skt.tmap.overlay.TMapPolygon
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class TmapMapModule : Module() {
  private val views = mutableSetOf<MapView>()
  private var foreground = true
  override fun definition() = ModuleDefinition {
    Name("MasscomTmapMap")
    OnActivityEntersForeground { foreground = true; views.forEach { it.syncRunning(foreground) } }
    OnActivityEntersBackground { foreground = false; views.forEach { it.syncRunning(foreground) } }
    View(MapView::class) {
      Events("onReady", "onError", "onViewport", "onSelect", "onCluster")
      Prop("appKey") { view: MapView, key: String -> view.setKey(key) }
      Prop("camera") { view: MapView, camera: Map<String, Double> -> view.setCamera(camera) }
      Prop("markers") { view: MapView, markers: List<Map<String, Any>> -> view.setMarkers(markers) }
      Prop("selectedId") { view: MapView, id: String? -> view.setSelection(id) }
      Prop("route") { view: MapView, route: Map<String, Any>? -> view.setRoute(route) }
      Prop("padding") { view: MapView, padding: Map<String, Int> -> view.setInsets(padding) }
      Prop("active") { view: MapView, active: Boolean -> view.active = active; view.syncRunning(foreground) }
      OnViewDidUpdateProps { view -> views.add(view) }
      OnViewDestroys { view -> views.remove(view); view.dispose() }
    }
  }
}

class MapView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // The SDK adds its rendering child after Yoga layout; honor its native requestLayout.
  override val shouldUseAndroidLayout = true
  private val map = TMapView(context)
  private val onReady by EventDispatcher()
  private val onError by EventDispatcher()
  private val onViewport by EventDispatcher()
  private val onSelect by EventDispatcher()
  private val onCluster by EventDispatcher()
  private var keySet = false
  private var ready = false
  // TMapView starts rendering when attached; the first inactive prop must pause it.
  private var running = true
  var active = false
  private var insets = TMapInsets(0, 0, 0, 0)
  private var camera: Map<String, Double>? = null
  private var markers: List<Map<String, Any>> = emptyList()
  private var selection: String? = null
  private var route: Map<String, Any>? = null
  private val iconCache = mutableMapOf<String, Bitmap>()
  init {
    orientation = VERTICAL
    addView(map, android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.MATCH_PARENT))
    map.setOnApiKeyListenerCallback(object : TMapView.OnApiKeyListenerCallback {
      override fun onSKTMapApikeySucceed() = Unit
      override fun onSKTMapApikeyFailed(message: String) { onError(mapOf("code" to "MAP_AUTH_FAILED", "retryable" to false)) }
    })
    map.setOnMapReadyListener {
      ready = true
      applyCamera()
      applyMarkers()
      applyRoute()
      onReady(emptyMap<String, Any>())
      emitViewport()
    }
    map.setOnPanChangedListener { emitViewport() }
    map.setOnZoomChangedListener { emitViewport() }
    map.setOnClickListenerCallback(object : TMapView.OnClickListenerCallback {
      override fun onPressDown(items: ArrayList<TMapMarkerItem>, pois: ArrayList<com.skt.tmap.poi.TMapPOIItem>, point: TMapPoint, screen: PointF) = Unit
      override fun onPressUp(items: ArrayList<TMapMarkerItem>, pois: ArrayList<com.skt.tmap.poi.TMapPOIItem>, point: TMapPoint, screen: PointF) {
        items.firstOrNull()?.id?.let { onSelect(mapOf("id" to it)) }
      }
    })
    map.setOnClickShapeListenerCallback(object : TMapView.OnClickShapeListenerCallback {
      override fun onClickCircle(circle: TMapCircle) = Unit
      override fun onClickPolyLine(line: TMapPolyLine) = Unit
      override fun onClickPolygon(polygon: TMapPolygon) = Unit
      override fun onClickCluster(items: List<TMapMarkerItem>) { onCluster(mapOf("ids" to items.map { it.id })) }
    })
    map.setEnableClustering(true)
  }
  fun setKey(key: String) {
    if (keySet || key.isBlank()) return
    keySet = true
    map.setSKTMapApiKey(key)
  }
  fun setCamera(value: Map<String, Double>) { camera = value; applyCamera() }
  private fun applyCamera() {
    if (!ready) return
    val c = camera ?: return
    val lat = c["latitude"] ?: return
    val lon = c["longitude"] ?: return
    val zoom = c["zoom"] ?: return
    if (!lat.isFinite() || !lon.isFinite() || !zoom.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return
    // Camera represents the unobscured part of the map; center offset leaves room for panels.
    val dx = (insets.left - insets.right) / 2f
    val dy = (insets.top - insets.bottom) / 2f
    val level = zoom.toInt().coerceIn(1, 19)
    val current = map.centerPoint
    if (dx == 0f && dy == 0f && current != null &&
      kotlin.math.abs(current.latitude - lat) < .00001 && kotlin.math.abs(current.longitude - lon) < .00001 &&
      map.zoomLevel == level) return
    map.setZoomLevel(level)
    // Controlled-camera echoes must not restart an unfinished SDK animation.
    map.setCenterPoint(lat, lon, false)
    if (width > 0 && height > 0 && (dx != 0f || dy != 0f)) {
      val shifted = map.convertPointToGps(width / 2f - dx, height / 2f - dy)
      map.setCenterPoint(shifted.latitude, shifted.longitude, false)
    }
    post { emitViewport() }
  }
  fun setInsets(value: Map<String, Int>) {
    insets = TMapInsets(value["left"] ?: 0, value["top"] ?: 0, value["right"] ?: 0, value["bottom"] ?: 0)
    applyCamera()
  }
  fun setSelection(id: String?) { selection = id; applyMarkers() }
  fun setMarkers(value: List<Map<String, Any>>) { markers = value; applyMarkers() }
  private fun applyMarkers() {
    if (!ready) return
    map.removeAllTMapMarkerItem()
    val serverClusters = markers.any { markerCount(it) != null }
    map.setEnableClustering(!serverClusters)
    markers.forEach { row ->
      val id = row["id"] as? String ?: return@forEach
      val lat = (row["latitude"] as? Number)?.toDouble() ?: return@forEach
      val lon = (row["longitude"] as? Number)?.toDouble() ?: return@forEach
      if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return@forEach
      val marker = TMapMarkerItem()
      marker.id = id
      marker.setTMapPoint(TMapPoint(lat, lon))
      marker.name = row["title"] as? String ?: ""
      val count = markerCount(row)
      marker.icon = markerIcon(id == selection, row["state"] as? String, count)
      marker.setEnableClustering(!serverClusters)
      map.addTMapMarkerItem(marker)
    }
  }
  private fun markerCount(row: Map<String, Any>): Int? {
    val value = (row["count"] as? Number)?.toDouble() ?: return null
    return if (value.isFinite() && value >= 1 && value <= 1_000_000 && value % 1 == 0.0) value.toInt() else null
  }
  private fun markerIcon(selected: Boolean, state: String?, count: Int?): Bitmap {
    val cacheKey = "$selected:$state:$count"
    iconCache[cacheKey]?.let { return it }
    val size = if (selected) 52 else 42
    val image = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(image)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = when (state) { "complete" -> Color.rgb(192, 132, 35); "visited" -> Color.rgb(43, 128, 105); "external" -> Color.rgb(92, 109, 129); else -> Color.rgb(205, 77, 63) }
    canvas.drawCircle(size / 2f, size / 2f, size * .36f, paint)
    paint.color = Color.WHITE
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = if (selected) 5f else 3f
    canvas.drawCircle(size / 2f, size / 2f, size * .36f, paint)
    if (count != null) {
      paint.style = Paint.Style.FILL
      paint.textAlign = Paint.Align.CENTER
      paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
      paint.textSize = if (count >= 1000) size * .25f else if (count >= 100) size * .30f else size * .40f
      canvas.drawText(count.toString(), size / 2f, size * .64f, paint)
    }
    iconCache[cacheKey] = image
    return image
  }
  fun setRoute(value: Map<String, Any>?) { route = value; applyRoute() }
  private fun applyRoute() {
    if (!ready) return
    map.removeAllTMapPolyLine()
    val data = route ?: return
    if (data["type"] != "MultiLineString") return
    val lines = data["coordinates"] as? List<*> ?: return
    lines.forEachIndexed { index, raw ->
      val points = raw as? List<*> ?: return@forEachIndexed
      val line = TMapPolyLine()
      line.setID("walk-$index")
      line.setLineColor(Color.rgb(42, 112, 178))
      line.setLineAlpha(255)
      line.setLineWidth(5f)
      points.forEach { pair ->
        val coords = pair as? List<*> ?: return@forEach
        val lon = (coords.getOrNull(0) as? Number)?.toDouble() ?: return@forEach
        val lat = (coords.getOrNull(1) as? Number)?.toDouble() ?: return@forEach
        if (lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0) line.addLinePoint(TMapPoint(lat, lon))
      }
      if (line.linePointList.size >= 2) map.addTMapPolyLine(line)
    }
  }
  private fun emitViewport() {
    if (!ready || !active) return
    val bounds = map.bounds ?: return
    val center = map.centerPoint ?: return
    onViewport(mapOf("bounds" to mapOf("west" to bounds.southWest.longitude, "south" to bounds.southWest.latitude,
      "east" to bounds.northEast.longitude, "north" to bounds.northEast.latitude),
      "camera" to mapOf("latitude" to center.latitude, "longitude" to center.longitude, "zoom" to map.zoomLevel)))
  }
  fun syncRunning(foreground: Boolean) {
    val shouldRun = active && foreground
    if (shouldRun == running) return
    running = shouldRun
    if (shouldRun) map.onResume() else map.onPause()
  }
  fun dispose() { ready = false; active = false; if (running) map.onPause(); running = false; map.onDestroy(); iconCache.values.forEach { it.recycle() }; iconCache.clear() }
}
