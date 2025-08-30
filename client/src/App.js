import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('mp4');
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState('');

  const handleDownload = async (e) => {
    e.preventDefault();
    
    if (!url.trim()) {
      setMessage('Please enter a YouTube URL');
      return;
    }

    setIsDownloading(true);
    setMessage('');

    try {
      const response = await axios({
        method: 'POST',
        url: 'http://localhost:5000/api/download',
        data: { url, format },
        responseType: 'blob', // Important for file download
      });

      // Create blob link to download
      const downloadUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = downloadUrl;
      
      // Extract filename from response headers or use default
      const contentDisposition = response.headers['content-disposition'];
      const filename = contentDisposition 
        ? contentDisposition.split('filename=')[1].replace(/"/g, '')
        : `download.${format}`;
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
      setMessage('Download completed!');
    } catch (error) {
      console.error('Download failed:', error);
      setMessage('Download failed. Please check the URL and try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🎥 YouTube Downloader</h1>
        <form onSubmit={handleDownload} className="download-form">
          <div className="input-group">
            <input
              type="url"
              placeholder="Paste YouTube URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isDownloading}
              className="url-input"
            />
          </div>
          
          <div className="input-group">
            <select 
              value={format} 
              onChange={(e) => setFormat(e.target.value)}
              disabled={isDownloading}
              className="format-select"
            >
              <option value="mp4">MP4 (Video)</option>
              <option value="mp3">MP3 (Audio)</option>
            </select>
          </div>
          
          <button 
            type="submit" 
            disabled={isDownloading}
            className="download-btn"
          >
            {isDownloading ? 'Downloading...' : 'Download'}
          </button>
        </form>
        
        {message && (
          <div className={`message ${message.includes('failed') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </header>
    </div>
  );
}

export default App;