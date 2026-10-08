package kr.masscom.studiovideo

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.net.Uri
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

class MasscomStampVideoModule : Module() {
  private val views = mutableSetOf<StampVideoView>()
  private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("MasscomStampVideo")
    Constant("supportsPlayback") { true }
    OnActivityEntersForeground {
      foreground = true
      views.forEach { it.syncForeground(foreground) }
    }
    OnActivityEntersBackground {
      foreground = false
      views.forEach { it.syncForeground(foreground) }
    }
    View(StampVideoView::class) {
      Events("onReady", "onEnded", "onError")
      Prop("uri") { view: StampVideoView, uri: String -> view.setUri(uri) }
      Prop("playing") { view: StampVideoView, playing: Boolean -> view.setPlaying(playing) }
      Prop("loop") { view: StampVideoView, loop: Boolean -> view.setLoop(loop) }
      Prop("muted") { view: StampVideoView, muted: Boolean -> view.setMuted(muted) }
      Prop("volume") { view: StampVideoView, volume: Double -> view.setVolume(volume) }
      OnViewDidUpdateProps { view ->
        views.add(view)
        view.syncForeground(foreground)
      }
      OnViewDestroys { view ->
        views.remove(view)
        view.dispose()
      }
    }
  }
}

class StampVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
  TextureView.SurfaceTextureListener {
  override val shouldUseAndroidLayout = true

  private val textureView = TextureView(context)
  private val onReady by EventDispatcher()
  private val onEnded by EventDispatcher()
  private val onError by EventDispatcher()

  private var uri: String? = null
  private var player: MediaPlayer? = null
  private var surface: Surface? = null
  private var sourceVersion = 0
  private var prepared = false
  private var preparing = false
  private var disposed = false
  private var foreground = true
  private var playing = false
  private var loop = false
  private var muted = false
  private var volume = 1f
  private var errorEmitted = false
  private var videoWidth = 0
  private var videoHeight = 0
  private var resumePositionMs = 0

  init {
    setBackgroundColor(android.graphics.Color.BLACK)
    textureView.surfaceTextureListener = this
    addView(textureView, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setUri(value: String) {
    val next = value.trim()
    if (uri == next) return
    uri = next.takeIf { it.isNotEmpty() }
    sourceVersion += 1
    errorEmitted = false
    releasePlayer()
    resumePositionMs = 0
    prepareIfPossible()
  }

  fun setPlaying(value: Boolean) {
    playing = value
    prepareIfPossible()
    syncPlayback()
  }

  fun setLoop(value: Boolean) {
    loop = value
    player?.isLooping = value
  }

  fun setMuted(value: Boolean) {
    muted = value
    applyVolume()
  }

  fun setVolume(value: Double) {
    volume = value.toFloat().coerceIn(0f, 1f)
    applyVolume()
  }

  fun syncForeground(value: Boolean) {
    foreground = value
    syncPlayback()
  }

  override fun onDetachedFromWindow() {
    // A native view can detach temporarily while the same React view remains mounted.
    releasePlayer()
    surface?.release()
    surface = null
    super.onDetachedFromWindow()
  }

  override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
    surface?.release()
    surface = Surface(surfaceTexture)
    prepareIfPossible()
  }

  override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
    updateTextureTransform()
  }

  override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
    releasePlayer()
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) = Unit

  fun dispose() {
    if (disposed) return
    disposed = true
    playing = false
    releasePlayer()
    surface?.release()
    surface = null
  }

  private fun prepareIfPossible() {
    val source = uri ?: return
    val targetSurface = surface ?: return
    if (disposed || errorEmitted || preparing || prepared) return
    val currentVersion = sourceVersion
    preparing = true
    prepared = false
    videoWidth = 0
    videoHeight = 0
    try {
      val nextPlayer = MediaPlayer()
      player = nextPlayer
      nextPlayer.setSurface(targetSurface)
      nextPlayer.isLooping = loop
      nextPlayer.setOnPreparedListener { mediaPlayer ->
        if (!isCurrent(mediaPlayer, currentVersion)) return@setOnPreparedListener
        preparing = false
        prepared = true
        videoWidth = mediaPlayer.videoWidth
        videoHeight = mediaPlayer.videoHeight
        applyVolume()
        updateTextureTransform()
        if (resumePositionMs > 0) mediaPlayer.seekTo(resumePositionMs)
        onReady(emptyMap<String, Any>())
        syncPlayback()
      }
      nextPlayer.setOnCompletionListener { mediaPlayer ->
        if (!isCurrent(mediaPlayer, currentVersion)) return@setOnCompletionListener
        if (!loop) {
          playing = false
          onEnded(emptyMap<String, Any>())
        }
      }
      nextPlayer.setOnVideoSizeChangedListener { mediaPlayer, width, height ->
        if (!isCurrent(mediaPlayer, currentVersion)) return@setOnVideoSizeChangedListener
        videoWidth = width
        videoHeight = height
        updateTextureTransform()
      }
      nextPlayer.setOnErrorListener { mediaPlayer, what, extra ->
        if (isCurrent(mediaPlayer, currentVersion)) emitError("PLAYBACK_FAILED", what, extra)
        true
      }
      nextPlayer.setDataSource(context, Uri.parse(source))
      applyVolume()
      nextPlayer.prepareAsync()
    } catch (error: Throwable) {
      emitError("SOURCE_FAILED", null, null)
      releasePlayer()
    }
  }

  private fun isCurrent(mediaPlayer: MediaPlayer, version: Int): Boolean {
    return !disposed && version == sourceVersion && player === mediaPlayer
  }

  private fun syncPlayback() {
    val mediaPlayer = player ?: return
    if (!prepared || disposed) return
    try {
      if (playing && foreground && surface != null) {
        if (!mediaPlayer.isPlaying) mediaPlayer.start()
      } else if (mediaPlayer.isPlaying) {
        mediaPlayer.pause()
      }
    } catch (error: IllegalStateException) {
      emitError("STATE_FAILED", null, null)
    }
  }

  private fun applyVolume() {
    val value = if (muted) 0f else volume
    try {
      player?.setVolume(value, value)
    } catch (error: IllegalStateException) {
      emitError("STATE_FAILED", null, null)
    }
  }

  private fun updateTextureTransform() {
    val viewWidth = textureView.width.toFloat()
    val viewHeight = textureView.height.toFloat()
    if (viewWidth <= 0f || viewHeight <= 0f || videoWidth <= 0 || videoHeight <= 0) {
      textureView.setTransform(null)
      return
    }
    val videoRatio = videoWidth.toFloat() / videoHeight.toFloat()
    val viewRatio = viewWidth / viewHeight
    val scaleX: Float
    val scaleY: Float
    if (videoRatio > viewRatio) {
      scaleX = 1f
      scaleY = viewRatio / videoRatio
    } else {
      scaleX = videoRatio / viewRatio
      scaleY = 1f
    }
    textureView.setTransform(Matrix().apply {
      setScale(scaleX, scaleY, viewWidth / 2f, viewHeight / 2f)
    })
  }

  private fun emitError(code: String, what: Int?, extra: Int?) {
    if (errorEmitted || disposed) return
    errorEmitted = true
    releasePlayer()
    onError(mapOf(
      "code" to code,
      "retryable" to true,
      "what" to (what ?: 0),
      "extra" to (extra ?: 0)
    ))
  }

  private fun releasePlayer() {
    val mediaPlayer = player
    player = null
    prepared = false
    preparing = false
    videoWidth = 0
    videoHeight = 0
    textureView.setTransform(null)
    if (mediaPlayer != null) {
      try {
        if (!errorEmitted) resumePositionMs = mediaPlayer.currentPosition
        if (mediaPlayer.isPlaying) mediaPlayer.stop()
      } catch (_: IllegalStateException) {
      } finally {
        mediaPlayer.release()
      }
    }
  }
}
