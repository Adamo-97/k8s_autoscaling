import express, { Request, Response } from 'express';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 3000;
const POD_NAME = process.env.HOSTNAME || os.hostname();

// Middleware
app.use(express.json());

// Main landing page with glassmorphism design
app.get('/', (req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>K8s Autoscaling Demo</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #4facfe 75%, #00f2fe 100%);
            background-size: 400% 400%;
            animation: gradientShift 15s ease infinite;
            overflow: hidden;
        }

        @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        .container {
            position: relative;
            z-index: 1;
        }

        .glass-card {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            padding: 60px 80px;
            text-align: center;
            animation: floatIn 1s ease-out;
            max-width: 600px;
        }

        @keyframes floatIn {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        h1 {
            color: #ffffff;
            font-size: 3rem;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            letter-spacing: -1px;
        }

        .subtitle {
            color: #f0f0f0;
            font-size: 1.2rem;
            margin-bottom: 40px;
            font-weight: 300;
        }

        .pod-info {
            background: rgba(255, 255, 255, 0.25);
            backdrop-filter: blur(5px);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 1px solid rgba(255, 255, 255, 0.4);
        }

        .pod-label {
            color: #e0e0e0;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 10px;
            font-weight: 600;
        }

        .pod-name {
            color: #ffffff;
            font-size: 2rem;
            font-weight: bold;
            font-family: 'Courier New', monospace;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2);
            word-break: break-all;
        }

        .features {
            margin-top: 40px;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }

        .feature-item {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(5px);
            padding: 15px;
            border-radius: 10px;
            color: #ffffff;
            font-size: 0.9rem;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .feature-icon {
            font-size: 1.5rem;
            margin-bottom: 5px;
        }

        .stress-btn {
            margin-top: 40px;
            padding: 15px 40px;
            font-size: 1.1rem;
            background: rgba(255, 255, 255, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.6);
            border-radius: 50px;
            color: #ffffff;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .stress-btn:hover {
            background: rgba(255, 255, 255, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }

        .footer {
            margin-top: 30px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.85rem;
        }

        /* Floating particles */
        .particle {
            position: absolute;
            background: rgba(255, 255, 255, 0.5);
            border-radius: 50%;
            animation: float 20s infinite;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0) translateX(0); }
            25% { transform: translateY(-100px) translateX(100px); }
            50% { transform: translateY(-50px) translateX(-100px); }
            75% { transform: translateY(-150px) translateX(50px); }
        }
    </style>
</head>
<body>
    <div class="particle" style="width: 60px; height: 60px; top: 10%; left: 10%; animation-delay: 0s;"></div>
    <div class="particle" style="width: 80px; height: 80px; top: 70%; left: 80%; animation-delay: 5s;"></div>
    <div class="particle" style="width: 40px; height: 40px; top: 40%; left: 70%; animation-delay: 10s;"></div>
    <div class="particle" style="width: 50px; height: 50px; top: 80%; left: 20%; animation-delay: 15s;"></div>

    <div class="container">
        <div class="glass-card">
            <h1>K8s Autoscaling</h1>
            <div class="subtitle">Horizontal Pod Autoscaler Demo on AWS EC2</div>
            
            <div class="pod-info">
                <div class="pod-label">Currently Served By Pod:</div>
                <div class="pod-name">${POD_NAME}</div>
            </div>

            <div class="features">
                <div class="feature-item">
                    <div class="feature-icon">AS</div>
                    <div>Auto-scaling</div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">EC2</div>
                    <div>AWS EC2</div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">MS</div>
                    <div>Metrics Server</div>
                </div>
                <div class="feature-item">
                    <div class="feature-icon">HPA</div>
                    <div>HPA Enabled</div>
                </div>
            </div>

            <button class="stress-btn" onclick="window.location.href='/stress'">
                Trigger CPU Load
            </button>

            <div class="footer">
                Kubernetes • Node.js • TypeScript • Docker
            </div>
        </div>
    </div>
</body>
</html>
  `;
  res.send(html);
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    pod: POD_NAME,
    timestamp: new Date().toISOString()
  });
});

// CPU-intensive stress endpoint for testing autoscaling
app.get('/stress', (req: Request, res: Response) => {
  const startTime = Date.now();
  const duration = 30000; // 30 seconds of stress

  // Perform CPU-intensive calculations
  let result = 0;
  while (Date.now() - startTime < duration) {
    for (let i = 0; i < 1000000; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
    }
  }

  const endTime = Date.now();
  const elapsedTime = endTime - startTime;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stress Test Complete</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            background-size: 400% 400%;
            animation: gradientShift 10s ease infinite;
        }

        @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        .glass-card {
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            padding: 60px 80px;
            text-align: center;
            max-width: 600px;
        }

        h1 {
            color: #ffffff;
            font-size: 2.5rem;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .info {
            background: rgba(255, 255, 255, 0.25);
            border-radius: 15px;
            padding: 20px;
            margin: 20px 0;
            border: 1px solid rgba(255, 255, 255, 0.4);
        }

        .label {
            color: #e0e0e0;
            font-size: 0.9rem;
            margin-bottom: 5px;
        }

        .value {
            color: #ffffff;
            font-size: 1.5rem;
            font-weight: bold;
            font-family: 'Courier New', monospace;
        }

        .back-btn {
            margin-top: 30px;
            padding: 15px 40px;
            font-size: 1.1rem;
            background: rgba(255, 255, 255, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.6);
            border-radius: 50px;
            color: #ffffff;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
            font-weight: 600;
        }

        .back-btn:hover {
            background: rgba(255, 255, 255, 0.5);
            transform: translateY(-2px);
        }

        .message {
            color: #ffffff;
            margin-top: 20px;
            font-size: 1.1rem;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="glass-card">
        <h1>Stress Test Complete!</h1>
        
        <div class="info">
            <div class="label">Pod Name:</div>
            <div class="value">${POD_NAME}</div>
        </div>

        <div class="info">
            <div class="label">Processing Time:</div>
            <div class="value">${elapsedTime}ms</div>
        </div>

        <div class="info">
            <div class="label">Calculation Result:</div>
            <div class="value">${result.toExponential(2)}</div>
        </div>

        <div class="message">
            This request triggered 30 seconds of intensive CPU calculations.<br>
            Watch your HPA scale up if CPU usage exceeds 50%!
        </div>

        <a href="/" class="back-btn">← Back to Home</a>
    </div>
</body>
</html>
  `;
  res.send(html);
});

// Start the server
app.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  console.log(`[POD] Name: ${POD_NAME}`);
  console.log(`[ENV] Environment: ${process.env.NODE_ENV || 'development'}`);
});
