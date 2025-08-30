const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
const testUrl = 'https://youtu.be/NY0u1DEKrug';

console.log('=== yt-dlp Diagnostic Tool ===\n');

async function runDiagnostics() {
  // 1. Check if binary exists
  console.log('1. Checking yt-dlp binary...');
  console.log('Path:', ytdlpPath);
  
  if (!fs.existsSync(ytdlpPath)) {
    console.log('❌ yt-dlp.exe not found!');
    console.log('Please download from: https://github.com/yt-dlp/yt-dlp/releases/latest');
    return;
  } else {
    const stats = fs.statSync(ytdlpPath);
    console.log('✅ Binary found');
    console.log('Size:', Math.round(stats.size / 1024 / 1024) + ' MB');
    console.log('Modified:', stats.mtime.toISOString());
  }

  // 2. Test version
  console.log('\n2. Testing version...');
  await testCommand(['--version']);

  // 3. Test help
  console.log('\n3. Testing help command...');
  await testCommand(['--help'], true); // true = expect long output

  // 4. Test simple info extraction
  console.log('\n4. Testing simple info extraction...');
  await testCommand(['-J', '--no-warnings', testUrl]);

  // 5. Test with different options
  console.log('\n5. Testing with basic options...');
  await testCommand(['-J', '--no-check-certificates', '--no-warnings', testUrl]);

  // 6. Test youtube-dl-exec
  console.log('\n6. Testing youtube-dl-exec package...');
  await testYoutubeDlExec();
}

function testCommand(args, expectLong = false) {
  return new Promise((resolve) => {
    console.log('Command:', ytdlpPath, args.join(' '));
    
    const process = spawn(ytdlpPath, args);
    let stdout = '';
    let stderr = '';
    let startTime = Date.now();

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      const duration = Date.now() - startTime;
      console.log(`Exit code: ${code} (${duration}ms)`);
      
      if (code === 0) {
        if (expectLong) {
          console.log(`✅ Success (${stdout.length} chars output)`);
        } else {
          console.log('✅ Success');
          if (stdout.trim()) {
            console.log('Output:', stdout.trim().substring(0, 200) + (stdout.length > 200 ? '...' : ''));
          }
        }
      } else {
        console.log('❌ Failed');
        if (stderr) {
          console.log('Error:', stderr.trim().substring(0, 300));
        }
        if (stdout) {
          console.log('Output:', stdout.trim().substring(0, 300));
        }
      }
      resolve();
    });

    process.on('error', (error) => {
      console.log('❌ Process error:', error.message);
      resolve();
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      process.kill();
      console.log('❌ Timeout (30s)');
      resolve();
    }, 30000);
  });
}

async function testYoutubeDlExec() {
  try {
    // Set the environment variable
    process.env.YTDLP_PATH = ytdlpPath;
    
    const youtubedl = require('youtube-dl-exec');
    
    console.log('Testing with youtube-dl-exec...');
    
    // Simple test
    const result = await youtubedl(testUrl, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true
    });
    
    console.log('✅ youtube-dl-exec success');
    console.log('Title:', result.title);
    console.log('Duration:', result.duration);
    console.log('Formats available:', result.formats ? result.formats.length : 0);
    
  } catch (error) {
    console.log('❌ youtube-dl-exec failed');
    console.log('Error type:', error.constructor.name);
    console.log('Error message:', error.message);
    
    if (error.stderr) {
      console.log('stderr:', error.stderr.substring(0, 300));
    }
    if (error.stdout) {
      console.log('stdout:', error.stdout.substring(0, 300));
    }
  }
}

// Run diagnostics
runDiagnostics().then(() => {
  console.log('\n=== Diagnostic Complete ===');
}).catch((error) => {
  console.error('Diagnostic failed:', error);
});