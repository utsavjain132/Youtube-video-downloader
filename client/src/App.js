import React, { useState, useRef } from "react";
import "./App.css";

// --- Configuration ---
// Make sure this matches the port your backend is running on.
const API_URL = "http://localhost:5000";

export default function App() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [downloadLink, setDownloadLink] = useState("");

  // Use a ref to store the interval ID to prevent issues with state updates
  const progressInterval = useRef(null);

  // --- 1. Get Video Info ---
  const handleGetInfo = async () => {
    if (!url) {
      setError("Please enter a YouTube URL.");
      return;
    }
    setIsLoading(true);
    setError("");
    setVideoInfo(null);
    setProgress(0);
    setDownloadLink("");

    try {
      const response = await fetch(`${API_URL}/api/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.details || "Failed to get video info.");
      }
      
      // Convert duration from seconds to MM:SS format
      const formatDuration = (seconds) => 
        new Date(seconds * 1000).toISOString().substr(14, 5);

      setVideoInfo({
        ...data,
        duration: formatDuration(data.duration),
        view_count: Number(data.view_count).toLocaleString(),
      });
      
      // Default to the first available video format
      if (data.videoFormats.length > 0) {
        setSelectedFormat(data.videoFormats[0].itag);
      }

    } catch (err) {
      setError(err.message);
      setVideoInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  // --- 2. Start Download and Poll for Progress ---
  const handleDownload = async () => {
    if (!selectedFormat) {
      setError("Please select a format first.");
      return;
    }

    setIsLoading(true);
    setError("");
    setProgress(0);
    setStage("Initializing...");

    try {
      // A. Start the download on the backend
      const downloadResponse = await fetch(`${API_URL}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, itag: selectedFormat }),
      });

      const downloadData = await downloadResponse.json();
      if (!downloadData.success) {
        throw new Error(downloadData.error || "Failed to start download.");
      }

      const { sessionId } = downloadData;

      // B. Poll for progress using the sessionId
      progressInterval.current = setInterval(async () => {
        try {
          const progressResponse = await fetch(`${API_URL}/api/progress/${sessionId}`);
          const progressData = await progressResponse.json();

          setProgress(progressData.progress || 0);
          setStage(progressData.stage || "");

          // C. Handle completion or error
          if (progressData.status === "completed") {
            clearInterval(progressInterval.current);
            setDownloadLink(`${API_URL}/api/file/${sessionId}`);
            setStage("Download ready!");
            setIsLoading(false);
          } else if (progressData.status === "error") {
            clearInterval(progressInterval.current);
            setError(`Error during download: ${progressData.error}`);
            setIsLoading(false);
          }
        } catch (err) {
          clearInterval(progressInterval.current);
          setError("Failed to get progress update.");
          setIsLoading(false);
        }
      }, 2000); // Poll every 2 seconds

    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>🎬 YouTube Downloader</h1>
      <p className="subtitle">
        Download YouTube videos with FFmpeg merging for best quality
      </p>

      <form id="downloadForm" onSubmit={(e) => { e.preventDefault(); handleGetInfo(); }}>
        <div className="form-group">
          <label htmlFor="url">YouTube URL:</label>
          <input
            type="url"
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
          />
        </div>
        <button type="submit" id="getInfoBtn" disabled={isLoading}>
          {isLoading && !progress ? "Fetching..." : "Get Video Info"}
        </button>
      </form>

      {error && <div className="error">❌ {error}</div>}

      {videoInfo && (
        <div id="videoInfo" className="video-info">
          <div className="video-header">
            <img src={videoInfo.thumbnail} alt="Video thumbnail" className="thumbnail" />
            <h3>{videoInfo.title}</h3>
          </div>
          <div className="video-details">
            <strong>Duration:</strong> <span>{videoInfo.duration}</span>
            <strong>Uploader:</strong> <span>{videoInfo.uploader}</span>
            <strong>Views:</strong> <span>{videoInfo.view_count}</span>
          </div>

          <div className="form-group">
            <label htmlFor="format">Format:</label>
            <select 
              id="format" 
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
            >
              {videoInfo.videoFormats.map((format) => (
                <option key={format.itag} value={format.itag}>
                  {format.quality} {format.filesize ? `(~${format.filesize} MB)`: ''}
                </option>
              ))}
              {videoInfo.audioFormats.map((format) => (
                <option key={format.itag} value={format.itag}>
                  Audio: {format.quality} {format.filesize ? `(~${format.filesize} MB)`: ''}
                </option>
              ))}
            </select>
            <p className="format-info">
              FFmpeg options provide the highest quality by merging separate streams.
            </p>
          </div>

          <button type="button" onClick={handleDownload} disabled={isLoading}>
             {isLoading && progress > 0 ? "Processing..." : "Download"}
          </button>
        </div>
      )}

      {isLoading && progress > 0 && (
        <div className="progress-container">
          <div className="progress-stage">{stage}</div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            >
              <span className="progress-text">{progress}%</span>
            </div>
          </div>
        </div>
      )}
      
      {downloadLink && (
         <div className="success">
           ✅ Download Ready!
           <div className="download-link">
             <a href={downloadLink} className="download-btn" download>
              Click here to Download File
             </a>
           </div>
         </div>
       )}

    </div>
  );
}