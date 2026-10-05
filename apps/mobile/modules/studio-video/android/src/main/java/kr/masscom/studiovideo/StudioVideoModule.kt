package kr.masscom.studiovideo

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.content.ContentValues
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/** Encodes an actual H.264 MP4 from the share card and its moving character/coin layers. */
class StudioVideoModule : Module() {
  private val cancelled = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("MasscomStudioVideo")

    AsyncFunction("cancelAsync") { cancelled.set(true) }.runOnQueue(Queues.MAIN)

    AsyncFunction("saveAsync") { uri: String ->
      saveMedia(uri, false)
    }

    AsyncFunction("saveImageAsync") { uri: String -> saveMedia(uri, true) }

    AsyncFunction("encodeAsync") { options: Map<String, Any> ->
      if (!cancelled.compareAndSet(true, false)) cancelled.set(false)
      encode(options)
    }
  }

  private fun saveMedia(uri: String, image: Boolean): Boolean {
    val context = appContext.reactContext ?: error("App context unavailable")
    val source = File(Uri.parse(uri).path ?: error("Invalid media URI"))
    require(source.isFile && source.length() > 0) { "Media file missing" }
    // Older Android keeps the existing share path without requesting legacy storage permission.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, "masscom-studio-${System.currentTimeMillis()}.${if (image) "png" else "mp4"}")
      put(MediaStore.MediaColumns.MIME_TYPE, if (image) "image/png" else "video/mp4")
      put(MediaStore.MediaColumns.RELATIVE_PATH, "${if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES}/MassCOM")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
      if (image) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Image cannot be decoded" }
        put(MediaStore.MediaColumns.WIDTH, bounds.outWidth)
        put(MediaStore.MediaColumns.HEIGHT, bounds.outHeight)
      }
    }
    val resolver = context.contentResolver
    val destination = resolver.insert(if (image) MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      else MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: error("Media library unavailable")
    try {
      resolver.openOutputStream(destination)?.use { output -> source.inputStream().use { it.copyTo(output) } }
        ?: error("Media library write failed")
      values.clear()
      values.put(MediaStore.MediaColumns.IS_PENDING, 0)
      resolver.update(destination, values, null, null)
      return true
    } catch (error: Throwable) {
      resolver.delete(destination, null, null)
      throw error
    }
  }

  private fun encode(options: Map<String, Any>): String {
    val context = appContext.reactContext ?: error("App context unavailable")
    val width = (options["width"] as Number).toInt()
    val height = (options["height"] as Number).toInt()
    val sceneHeight = (options["sceneHeight"] as Number).toInt()
    val sceneTop = (options["sceneTop"] as? Number)?.toFloat() ?: 0f
    val coinSizeRatio = (options["coinSizeRatio"] as? Number)?.toFloat() ?: .30f
    require(width == 1080 && (height == 1350 || height == 1920)) { "Unsupported share size" }
    val background = readBitmap(options["backgroundUri"] as String)
    val avatar = (options["avatarUri"] as? String)?.let(::readBitmap)
    val coin = (options["coinUri"] as? String)?.let(::readBitmap)
    val coinColors = (options["coinColors"] as? List<*>)?.mapNotNull { value ->
      (value as? String)?.let { runCatching { Color.parseColor(it) }.getOrNull() }
    }?.takeIf { it.size >= 2 }?.toIntArray()
      ?: intArrayOf(Color.parseColor("#E3BB8B"), Color.parseColor("#FFF1DC"), Color.parseColor("#A9673F"))
    val output = File(context.cacheDir, "masscom-studio-${SystemClock.elapsedRealtimeNanos()}.mp4")
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, 4_500_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var muxerStarted = false
    var track = -1
    val bufferInfo = MediaCodec.BufferInfo()
    val frame = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val pixels = IntArray(width * 2)
    val canvas = Canvas(frame)
    var yuvRows: YuvRows? = null
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      val totalFrames = FPS * DURATION_SECONDS
      for (index in 0 until totalFrames) {
        if (cancelled.get()) throw InterruptedException("Video export cancelled")
        renderFrame(canvas, background, avatar, coin, coinColors, width, height, sceneHeight, sceneTop, coinSizeRatio, index.toFloat() / totalFrames)
        val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
        if (inputIndex < 0) error("Video encoder input timed out")
        val image = codec.getInputImage(inputIndex) ?: error("Video encoder has no YUV input image")
        try {
          val rows = yuvRows ?: YuvRows(width, image.planes).also { yuvRows = it }
          copyYuv420(frame, image.planes, pixels, rows)
        } finally { image.close() }
        codec.queueInputBuffer(inputIndex, 0, width * height * 3 / 2,
          index.toLong() * 1_000_000L / FPS, 0)
        while (true) {
          val outputIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
          if (outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER) break
          if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxerStarted = true
          } else if (outputIndex >= 0) {
            if (bufferInfo.size > 0) {
              val data = codec.getOutputBuffer(outputIndex) ?: error("Video encoder output missing")
              data.position(bufferInfo.offset)
              data.limit(bufferInfo.offset + bufferInfo.size)
              muxer.writeSampleData(track, data, bufferInfo)
            }
            codec.releaseOutputBuffer(outputIndex, false)
          }
        }
      }
      val eosIndex = codec.dequeueInputBuffer(TIMEOUT_US)
      if (eosIndex < 0) error("Video encoder end marker timed out")
      codec.queueInputBuffer(eosIndex, 0, 0, DURATION_SECONDS * 1_000_000L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      var ended = false
      while (!ended) {
        val outputIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
        } else if (outputIndex >= 0) {
          if (bufferInfo.size > 0) {
            val data = codec.getOutputBuffer(outputIndex) ?: error("Video encoder output missing")
            data.position(bufferInfo.offset)
            data.limit(bufferInfo.offset + bufferInfo.size)
            muxer.writeSampleData(track, data, bufferInfo)
          }
          ended = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(outputIndex, false)
        }
      }
      if (!muxerStarted || output.length() == 0L) error("Video encoder produced no file")
      return Uri.fromFile(output).toString()
    } catch (error: Throwable) {
      output.delete()
      throw error
    } finally {
      frame.recycle()
      background.recycle()
      avatar?.recycle()
      coin?.recycle()
      codec.stop()
      codec.release()
      if (muxerStarted) muxer.stop()
      muxer.release()
    }
  }

  private fun readBitmap(uri: String): Bitmap {
    val path = Uri.parse(uri).path ?: error("Invalid image URI")
    return BitmapFactory.decodeFile(path) ?: error("Unable to decode share image")
  }

  private fun renderFrame(canvas: Canvas, background: Bitmap, avatar: Bitmap?, coin: Bitmap?, coinColors: IntArray,
    width: Int, height: Int, sceneHeight: Int, sceneTop: Float, coinSizeRatio: Float, progress: Float) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(background, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), paint)
    canvas.save()
    canvas.translate(0f, sceneTop)
    if (avatar != null) {
      val bounce = sin(progress * Math.PI * 4).toFloat() * 19f
      val size = minOf(width * .43f, sceneHeight * .46f)
      val x = width * .285f
      val y = sceneHeight * .83f - size + bounce
      canvas.drawBitmap(avatar, null, RectF(x, y, x + size, y + size), paint)
    }
    if (coin != null) {
      val cx = width * .235f
      val cy = sceneHeight * .23f
      val radius = width * coinSizeRatio / 2f
      val phase = progress * Math.PI * 4
      val faceWidth = max(.12f, abs(cos(phase).toFloat()))
      val side = sin(phase).toFloat()
      canvas.save()
      canvas.translate(cx + side * 15f, cy)
      canvas.scale(faceWidth, 1f)
      val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = coinColors.last() }
      canvas.drawCircle(5f, 7f, radius + 8f, edge)
      edge.shader = LinearGradient(-radius, -radius, radius, radius,
        coinColors,
        null, Shader.TileMode.CLAMP)
      canvas.drawCircle(0f, 0f, radius + 4f, edge)
      val clip = Path().apply { addCircle(0f, 0f, radius - 9f, Path.Direction.CW) }
      canvas.save()
      canvas.clipPath(clip)
      canvas.drawBitmap(coin, null, RectF(-radius + 9f, -radius + 9f, radius - 9f, radius - 9f), paint)
      val gleam = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader = LinearGradient(-radius * 2f + progress * radius * 5f, -radius,
          -radius + progress * radius * 5f, radius,
          intArrayOf(Color.TRANSPARENT, 0xAAFFFFFF.toInt(), Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
      }
      canvas.drawRect(-radius, -radius, radius, radius, gleam)
      canvas.restore()
      canvas.restore()
    }
    canvas.restore()
  }

  private class YuvRows(width: Int, planes: Array<android.media.Image.Plane>) {
    val y = ByteArray(width * 2)
    val u = ByteArray(width / 2)
    val v = ByteArray(width / 2)
    val scratch = planes.map { ByteArray(it.rowStride) }
  }

  private fun writePlaneRow(plane: android.media.Image.Plane, row: Int, values: ByteArray,
    sourceOffset: Int, count: Int, scratch: ByteArray) {
    val offset = row * plane.rowStride
    if (plane.pixelStride == 1) {
      plane.buffer.position(offset)
      plane.buffer.put(values, sourceOffset, count)
    } else {
      // Flexible YUV can share interleaved U/V storage. Preserve the other plane's bytes.
      val length = minOf(plane.rowStride, plane.buffer.limit() - offset)
      plane.buffer.position(offset)
      plane.buffer.get(scratch, 0, length)
      for (col in 0 until count) scratch[col * plane.pixelStride] = values[sourceOffset + col]
      plane.buffer.position(offset)
      plane.buffer.put(scratch, 0, length)
    }
  }

  private fun copyYuv420(bitmap: Bitmap, planes: Array<android.media.Image.Plane>, pixels: IntArray, rows: YuvRows) {
    val width = bitmap.width
    val height = bitmap.height
    val y = planes[0]; val u = planes[1]; val v = planes[2]
    for (row in 0 until height step 2) {
      bitmap.getPixels(pixels, 0, width, 0, row, width, 2)
      for (col in 0 until width step 2) {
        var red = 0; var green = 0; var blue = 0
        for (dy in 0..1) for (dx in 0..1) {
          val color = pixels[dy * width + col + dx]
          val r = Color.red(color); val g = Color.green(color); val b = Color.blue(color)
          red += r; green += g; blue += b
          val luma = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
          rows.y[dy * width + col + dx] = luma.toByte()
        }
        red /= 4; green /= 4; blue /= 4
        rows.u[col / 2] = (((-38 * red - 74 * green + 112 * blue + 128) shr 8) + 128).toByte()
        rows.v[col / 2] = (((112 * red - 94 * green - 18 * blue + 128) shr 8) + 128).toByte()
      }
      writePlaneRow(y, row, rows.y, 0, width, rows.scratch[0])
      writePlaneRow(y, row + 1, rows.y, width, width, rows.scratch[0])
      writePlaneRow(u, row / 2, rows.u, 0, width / 2, rows.scratch[1])
      writePlaneRow(v, row / 2, rows.v, 0, width / 2, rows.scratch[2])
    }
  }

  companion object {
    private const val FPS = 20
    private const val DURATION_SECONDS = 4
    private const val TIMEOUT_US = 10_000L
  }
}
