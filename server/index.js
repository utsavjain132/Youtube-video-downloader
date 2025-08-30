const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Store download progress for each session
const downloadProgress = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'YouTube Downloader API with FFmpeg merging!' });
});

// Get download progress
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const progress = downloadProgress.get(sessionId) || { status: 'not_found' };
  res.json(progress);
});

// Debug endpoint to see all available formats
app.post('/api/debug', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const info = await ytdl.getInfo(url);
    const formats = info.formats;
    
    const debugData = formats.map(format => ({
      itag: format.itag,
      quality: format.qualityLabel || format.quality,
      container: format.container,
      hasVideo: format.hasVideo,
      hasAudio: format.hasAudio,
      mimeType: format.mimeType,
      filesize: format.contentLength ? Math.round(format.contentLength / 1024 / 1024) + ' MB' : 'Unknown',
      fps: format.fps,
      audioBitrate: format.audioBitrate
    }));
    
    res.json({
      success: true,
      totalFormats: formats.length,
      formats: debugData
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get video info and available formats
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log('Getting info for:', url);
    
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }
    });
    
    const videoDetails = info.videoDetails;
    const formats = info.formats;
    
    console.log('Available formats:', formats.length);
    
    // Get combined formats (video + audio)
    const combinedFormats = formats
      .filter(format => format.hasVideo && format.hasAudio && format.container === 'mp4')
      .map(format => ({
        quality: `${format.qualityLabel || format.quality} (combined)`,
        itag: format.itag,
        fps: format.fps,
        bitrate: format.bitrate,
        mimeType: format.mimeType,
        filesize: format.contentLength ? Math.round(format.contentLength / 1024 / 1024) : null,
        type: 'combined',
        hasAudio: true
      }));
    
    // Get video-only formats (for FFmpeg merging)
    const videoOnlyFormats = formats
      .filter(format => {
        return format.hasVideo && !format.hasAudio && 
               format.qualityLabel && 
               (format.container === 'mp4' || format.mimeType?.includes('video/mp4'));
      })
      .map(format => ({
        quality: `${format.qualityLabel} (video-only, will merge with audio)`,
        itag: format.itag,
        fps: format.fps,
        bitrate: format.bitrate,
        mimeType: format.mimeType,
        filesize: format.contentLength ? Math.round(format.contentLength / 1024 / 1024) : null,
        type: 'video-only',
        hasAudio: false
      }));
    
    // Sort and combine formats
    const allFormats = [...combinedFormats, ...videoOnlyFormats];
    const videoFormats = allFormats
      .sort((a, b) => {
        const aHeight = parseInt(a.quality.match(/(\d+)p/)?.[1] || '0');
        const bHeight = parseInt(b.quality.match(/(\d+)p/)?.[1] || '0');
        
        // Prioritize higher resolution
        if (bHeight !== aHeight) return bHeight - aHeight;
        
        // Then prioritize combined formats
        if (a.hasAudio && !b.hasAudio) return -1;
        if (!a.hasAudio && b.hasAudio) return 1;
        
        return 0;
      })
      .slice(0, 15);

    // Audio-only formats
    const audioFormats = formats
      .filter(format => format.hasAudio && !format.hasVideo)
      .map(format => ({
        quality: format.audioBitrate ? `${format.audioBitrate}kbps` : 'Unknown',
        itag: format.itag,
        bitrate: format.audioBitrate,
        mimeType: format.mimeType,
        filesize: format.contentLength ? Math.round(format.contentLength / 1024 / 1024) : null
      }))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
      .slice(0, 5);

    // Preset options with FFmpeg merging
    const presetFormats = [
      { quality: 'Best Quality (FFmpeg merge)', itag: 'ffmpeg-best', type: 'preset' },
      { quality: 'Best Combined Format', itag: 'highest-audio', type: 'preset' },
      { quality: 'Medium Quality (FFmpeg merge)', itag: 'ffmpeg-medium', type: 'preset' }
    ];

    res.json({
      success: true,
      title: videoDetails.title,
      duration: videoDetails.lengthSeconds,
      thumbnail: videoDetails.thumbnails?.[0]?.url,
      uploader: videoDetails.author?.name,
      view_count: videoDetails.viewCount,
      videoFormats: [...presetFormats, ...videoFormats],
      audioFormats,
      debug: {
        totalFormats: formats.length,
        combinedFormats: combinedFormats.length,
        videoOnlyFormats: videoOnlyFormats.length,
        audioOnlyFormats: audioFormats.length
      }
    });

  } catch (error) {
    console.error('Info error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get video information',
      details: error.message 
    });
  }
});

// Enhanced download endpoint with FFmpeg merging and progress tracking
app.post('/api/download', async (req, res) => {
  const sessionId = uuidv4();
  
  try {
    const { url, format, quality, itag } = req.body;
    
    console.log('Download request:', { url, format, quality, itag, sessionId });
    
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Initialize progress tracking
    downloadProgress.set(sessionId, {
      status: 'initializing',
      progress: 0,
      stage: 'Getting video information...'
    });

    // Return session ID immediately for progress tracking
    res.json({ 
      success: true, 
      sessionId,
      message: 'Download started. Use the session ID to track progress.' 
    });

    // Get video info
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    });
    
    const title = info.videoDetails.title.replace(/[^\w\s-]/gi, '').replace(/\s+/g, '_');
    const duration = parseInt(info.videoDetails.lengthSeconds);

    if (format === 'mp3') {
      // Audio-only download
      await downloadAudio(url, title, sessionId, itag);
    } else {
      // Video download - check if FFmpeg merging is needed
      if (itag === 'ffmpeg-best' || itag === 'ffmpeg-medium') {
        await downloadAndMergeWithFFmpeg(url, info, title, sessionId, itag === 'ffmpeg-best');
      } else {
        // Regular video download (combined format)
        await downloadRegularVideo(url, title, sessionId, itag, info);
      }
    }

  } catch (error) {
    console.error('Download error:', error.message);
    downloadProgress.set(sessionId, {
      status: 'error',
      progress: 0,
      stage: 'Error occurred',
      error: error.message
    });
  }
});

// Download audio only
async function downloadAudio(url, title, sessionId, itag) {
  return new Promise((resolve, reject) => {
    downloadProgress.set(sessionId, {
      status: 'downloading',
      progress: 0,
      stage: 'Downloading audio...'
    });

    const outputPath = path.join(tempDir, `${title}_${sessionId}.mp3`);
    
    const audioOptions = {
      filter: 'audioonly',
      quality: itag && itag !== 'highest' ? itag : 'highestaudio',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    };

    const stream = ytdl(url, audioOptions);
    const writeStream = fs.createWriteStream(outputPath);
    
    stream.pipe(writeStream);

    stream.on('progress', (chunkLength, downloaded, total) => {
      const progress = Math.round((downloaded / total) * 100);
      downloadProgress.set(sessionId, {
        status: 'downloading',
        progress,
        stage: `Downloading audio... ${progress}%`,
        downloadedBytes: downloaded,
        totalBytes: total
      });
    });

    writeStream.on('finish', () => {
      downloadProgress.set(sessionId, {
        status: 'completed',
        progress: 100,
        stage: 'Download completed!',
        filePath: outputPath,
        filename: `${title}.mp3`
      });
      resolve();
    });

    stream.on('error', reject);
    writeStream.on('error', reject);
  });
}

// Download regular video (combined format)
async function downloadRegularVideo(url, title, sessionId, itag, info) {
  return new Promise((resolve, reject) => {
    downloadProgress.set(sessionId, {
      status: 'downloading',
      progress: 0,
      stage: 'Downloading video...'
    });

    const outputPath = path.join(tempDir, `${title}_${sessionId}.mp4`);
    
    let videoOptions = {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    };

    // Apply quality selection logic (same as before)
    if (itag && !['highest', 'highest-audio'].includes(itag)) {
      videoOptions.quality = itag;
    } else {
      // Find best combined format
      const videoWithAudioFormats = info.formats
        .filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4')
        .sort((a, b) => {
          const aHeight = parseInt(a.qualityLabel?.replace('p', '') || '0');
          const bHeight = parseInt(b.qualityLabel?.replace('p', '') || '0');
          if (bHeight !== aHeight) return bHeight - aHeight;
          return (b.bitrate || 0) - (a.bitrate || 0);
        });
      
      if (videoWithAudioFormats.length > 0) {
        videoOptions.quality = videoWithAudioFormats[0].itag;
      } else {
        videoOptions.filter = 'videoandaudio';
        videoOptions.quality = 'highest';
      }
    }

    const stream = ytdl(url, videoOptions);
    const writeStream = fs.createWriteStream(outputPath);
    
    stream.pipe(writeStream);

    stream.on('progress', (chunkLength, downloaded, total) => {
      const progress = Math.round((downloaded / total) * 100);
      downloadProgress.set(sessionId, {
        status: 'downloading',
        progress,
        stage: `Downloading video... ${progress}%`,
        downloadedBytes: downloaded,
        totalBytes: total
      });
    });

    writeStream.on('finish', () => {
      downloadProgress.set(sessionId, {
        status: 'completed',
        progress: 100,
        stage: 'Download completed!',
        filePath: outputPath,
        filename: `${title}.mp4`
      });
      resolve();
    });

    stream.on('error', reject);
    writeStream.on('error', reject);
  });
}

// Download and merge with FFmpeg
async function downloadAndMergeWithFFmpeg(url, info, title, sessionId, useBestQuality) {
  const videoPath = path.join(tempDir, `${title}_video_${sessionId}.mp4`);
  const audioPath = path.join(tempDir, `${title}_audio_${sessionId}.m4a`);
  const outputPath = path.join(tempDir, `${title}_merged_${sessionId}.mp4`);

  try {
    // Step 1: Download video-only stream
    downloadProgress.set(sessionId, {
      status: 'downloading',
      progress: 0,
      stage: 'Downloading video stream...'
    });

    await downloadVideoStream(url, videoPath, info, useBestQuality, sessionId, 'video');

    // Step 2: Download audio-only stream
    downloadProgress.set(sessionId, {
      status: 'downloading',
      progress: 50,
      stage: 'Downloading audio stream...'
    });

    await downloadAudioStream(url, audioPath, sessionId, 'audio');

    // Step 3: Merge with FFmpeg
    downloadProgress.set(sessionId, {
      status: 'merging',
      progress: 75,
      stage: 'Merging video and audio with FFmpeg...'
    });

    await mergeWithFFmpeg(videoPath, audioPath, outputPath, sessionId);

    // Clean up temporary files
    fs.unlinkSync(videoPath);
    fs.unlinkSync(audioPath);

    downloadProgress.set(sessionId, {
      status: 'completed',
      progress: 100,
      stage: 'Download and merge completed!',
      filePath: outputPath,
      filename: `${title}_merged.mp4`
    });

  } catch (error) {
    // Clean up on error
    [videoPath, audioPath, outputPath].forEach(path => {
      if (fs.existsSync(path)) fs.unlinkSync(path);
    });
    throw error;
  }
}

// Download video stream
function downloadVideoStream(url, outputPath, info, useBestQuality, sessionId, streamType) {
  return new Promise((resolve, reject) => {
    const videoFormats = info.formats
      .filter(f => f.hasVideo && !f.hasAudio)
      .sort((a, b) => {
        const aHeight = parseInt(a.qualityLabel?.replace('p', '') || '0');
        const bHeight = parseInt(b.qualityLabel?.replace('p', '') || '0');
        return bHeight - aHeight;
      });

    if (videoFormats.length === 0) {
      return reject(new Error('No video-only formats found'));
    }

    const selectedFormat = useBestQuality ? videoFormats[0] : videoFormats[Math.floor(videoFormats.length / 2)] || videoFormats[0];
    
    console.log(`Selected ${streamType} format:`, selectedFormat.qualityLabel, 'itag:', selectedFormat.itag);

    const stream = ytdl(url, { quality: selectedFormat.itag });
    const writeStream = fs.createWriteStream(outputPath);
    
    stream.pipe(writeStream);

    stream.on('progress', (chunkLength, downloaded, total) => {
      const baseProgress = streamType === 'video' ? 0 : 50;
      const progress = baseProgress + Math.round((downloaded / total) * 25);
      
      const currentProgress = downloadProgress.get(sessionId);
      downloadProgress.set(sessionId, {
        ...currentProgress,
        progress,
        stage: `Downloading ${streamType} stream... ${Math.round((downloaded / total) * 100)}%`
      });
    });

    writeStream.on('finish', resolve);
    stream.on('error', reject);
    writeStream.on('error', reject);
  });
}

// Download audio stream
function downloadAudioStream(url, outputPath, sessionId, streamType) {
  return new Promise((resolve, reject) => {
    const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
    const writeStream = fs.createWriteStream(outputPath);
    
    stream.pipe(writeStream);

    stream.on('progress', (chunkLength, downloaded, total) => {
      const baseProgress = 50;
      const progress = baseProgress + Math.round((downloaded / total) * 25);
      
      const currentProgress = downloadProgress.get(sessionId);
      downloadProgress.set(sessionId, {
        ...currentProgress,
        progress,
        stage: `Downloading ${streamType} stream... ${Math.round((downloaded / total) * 100)}%`
      });
    });

    writeStream.on('finish', resolve);
    stream.on('error', reject);
    writeStream.on('error', reject);
  });
}

// Merge video and audio with FFmpeg
function mergeWithFFmpeg(videoPath, audioPath, outputPath, sessionId) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',  // Copy video codec (no re-encoding)
        '-c:a aac',   // Use AAC audio codec
        '-strict experimental'
      ])
      .on('start', (commandLine) => {
        console.log('FFmpeg started:', commandLine);
      })
      .on('progress', (progress) => {
        const percent = Math.round(progress.percent) || 0;
        const totalProgress = 75 + Math.round(percent * 0.25); // 75-100%
        
        downloadProgress.set(sessionId, {
          status: 'merging',
          progress: totalProgress,
          stage: `Merging with FFmpeg... ${percent}%`,
          ffmpegProgress: {
            percent: percent,
            currentTime: progress.timemark,
            targetSize: progress.targetSize
          }
        });
      })
      .on('end', () => {
        console.log('FFmpeg merge completed');
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

// Serve downloaded files
app.get('/api/file/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const progress = downloadProgress.get(sessionId);
  
  if (!progress || progress.status !== 'completed') {
    return res.status(404).json({ error: 'File not found or not ready' });
  }
  
  const filePath = progress.filePath;
  const filename = progress.filename;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }
  
  res.download(filePath, filename, (err) => {
    if (!err) {
      // Clean up file after download
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          downloadProgress.delete(sessionId);
        }
      }, 60000); // Delete after 1 minute
    }
  });
});

// Clean up old progress entries (run every hour)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [sessionId, progress] of downloadProgress.entries()) {
    if (progress.timestamp && progress.timestamp < oneHourAgo) {
      downloadProgress.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('YouTube Downloader with FFmpeg merging ready!');
  console.log('Make sure FFmpeg is installed and available in PATH');
});