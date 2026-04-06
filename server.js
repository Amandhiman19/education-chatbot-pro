import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Database & AI
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔐 ADMIN AUTH (Simple token)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123-change-this';

// 🗣️ MAIN CHAT - SAVES EVERY MESSAGE
app.post('/api/chat', async (req, res) => {
  const { message, userId, sessionId } = req.body;
  
  try {
    // SAVE USER MESSAGE
    await pool.query(
      'INSERT INTO conversations (user_id, message, sender, session_id) VALUES ($1, $2, $3, $4)',
      [userId || 'anonymous', message, 'user', sessionId || 'session_' + Date.now()]
    );

    // AI RESPONSE
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are professional education assistant for coaching platform.
          
Available coaches:
- John Math Expert ($35/hr) - Math, Algebra
- Sarah English Pro ($28/hr) - English, IELTS

Help students:
1. Find coaches by subject
2. Explain booking process
3. Answer education questions
4. Be professional & encouraging`
        },
        { role: "user", content: message }
      ]
    });

    const aiResponse = completion.choices[0].message.content;

    // SAVE BOT RESPONSE
    await pool.query(
      'UPDATE conversations SET response = $1 WHERE message = $2 AND sender = $3',
      [aiResponse, message, 'user']
    );

    res.json({ 
      response: aiResponse,
      success: true,
      sessionId: sessionId || 'session_' + Date.now()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.json({ 
      response: "Thank you for your message! Our team will get back to you soon.",
      success: false 
    });
  }
});

// 👑 ADMIN DASHBOARD - ALL DATA
app.get('/api/admin/dashboard', async (req, res) => {
  const token = req.headers.authorization;
  if (token !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [stats, recentChats, bookings, coaches] = await Promise.all([
      // Stats
      pool.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE role='coach') as total_coaches,
          COUNT(*) FILTER (WHERE role='student') as total_students,
          COUNT(bookings) as total_bookings
        FROM users LEFT JOIN bookings ON users.id = bookings.student_id
      `),
      
      // Recent conversations
      pool.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 50'),
      
      // Recent bookings
      pool.query('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 20'),
      
      // Coaches
      pool.query(`
        SELECT u.name, u.email, c.hourly_rate, c.rating, COUNT(b.id) as bookings 
        FROM users u 
        JOIN coaches c ON u.id = c.id 
        LEFT JOIN bookings b ON c.id = b.coach_id 
        WHERE u.role = 'coach' 
        GROUP BY u.id, c.id
      `)
    ]);

    res.json({
      stats: stats.rows[0],
      conversations: recentChats.rows,
      bookings: bookings.rows,
      coaches: coaches.rows,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 📈 SEARCH COACHES
app.post('/api/search-coaches', async (req, res) => {
  const { subject } = req.body;
  const result = await pool.query(`
    SELECT u.name, u.email, c.hourly_rate, c.rating, c.bio
    FROM users u JOIN coaches c ON u.id = c.id
    WHERE c.subjects @> $1::jsonb
    ORDER BY c.rating DESC
  `, [JSON.stringify([subject])]);
  res.json(result.rows);
});

// 📦 PROFESSIONAL WIDGET
app.get('/widget.js', (req, res) => {
  res.type('text/javascript');
  res.send(`
    class ProfessionalEduBot {
      constructor() {
        this.sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.createUI();
        this.bindEvents();
        this.welcome();
      }
      
      createUI() {
        document.body.insertAdjacentHTML('beforeend', \`
          <div id="pro-edubot" style="position:fixed;bottom:25px;right:25px;z-index:99999;font-family:-apple-system,Segoe UI,sans-serif;">
            <button id="bot-toggle" style="width:65px;height:65px;border:none;border-radius:50%;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;font-size:24px;cursor:pointer;box-shadow:0 8px 32px rgba(102,126,234,0.4);transition:all 0.3s ease;">
              💬
            </button>
            <div id="bot-panel" style="display:none;width:380px;height:520px;background:linear-gradient(145deg,#ffffff,#f0f2f5);border-radius:24px;box-shadow:0 25px 80px rgba(0,0,0,0.25);margin-top:15px;overflow:hidden;border:1px solid rgba(255,255,255,0.2);backdrop-filter:blur(10px);">
              <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:20px;font-weight:600;font-size:16px;box-shadow:0 4px 20px rgba(102,126,234,0.3);">
                🎓 Professional Education Assistant
              </div>
              <div id="messages" style="height:360px;overflow-y:auto;padding:25px 20px;background:#fafbfc;font-size:15px;line-height:1.5;"></div>
              <div style="padding:20px 25px 25px;border-top:1px solid #e8ecf4;display:flex;gap:10px;">
                <input id="msg-input" placeholder="Ask about coaching, courses, or tutors..." style="flex:1;border:2px solid #e8ecf4;padding:14px 16px;border-radius:16px;font-size:15px;outline:none;transition:border-color 0.2s;">
                <button id="send-btn" style="width:70px;height:50px;border:none;border-radius:16px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(102,126,234,0.3);">Send</button>
              </div>
            </div>
          </div>
        \`);
      }
      
      async sendMessage() {
        const input = document.getElementById('msg-input');
        const message = input.value.trim();
        if (!message) return;
        
        this.addMessage('You', message, 'user');
        input.value = '';
        
        try {
          const response = await fetch(window.location.origin.includes('vercel.app') ? 
            '/api/chat' : '${window.location.origin}/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              message, 
              userId: localStorage.getItem('userId') || 'guest',
              sessionId: this.sessionId 
            })
          });
          
          const data = await response.json();
          this.addMessage('Assistant', data.response, 'bot');
        } catch (e) {
          this.addMessage('Assistant', 'Connection issue. Please refresh and try again.', 'bot');
        }
      }
      
      addMessage(sender, text, type) {
        const messages = document.getElementById('messages');
        const div = document.createElement('div');
        div.style.cssText = type === 'user' ? 
          'margin-bottom:20px;text-align:right;' : 
          'margin-bottom:20px;text-align:left;';
        div.innerHTML = \`
          <div style="display:inline-block;max-width:280px;padding:12px 16px;border-radius:18px;
            ${type === 'user' ? 'background:linear-gradient(135deg,#667eea,#764ba2);color:white;' : 
              'background:white;border:1px solid #e8ecf4;color:#374151;'} 
            box-shadow:0 2px 8px rgba(0,0,0,0.1);word-wrap:break-word;">
            ${text.replace(/\\n/g, '<br>')}
          </div>
        \`;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
      }
      
      welcome() {
        setTimeout(() => {
          this.addMessage('Assistant', 
            'Hello! 👋 I\'m your education assistant. I can help you:<br>' +
            '• Find expert coaches (Math, English, Science)<br>' +
            '• Check availability & rates<br>' +
            '• Answer course questions<br>' +
            '<br>Ask me anything about coaching!', 'bot');
        }, 1000);
      }
      
      bindEvents() {
        document.getElementById('bot-toggle').onclick = () => {
          const panel = document.getElementById('bot-panel');
          panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        };
        document.getElementById('send-btn').onclick = () => this.sendMessage();
        document.getElementById('msg-input').onkeypress = (e) => {
          if (e.key === 'Enter') this.sendMessage();
        };
      }
    }
    
    window.proEduBot = new ProfessionalEduBot();
  `);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🏢 Professional Education Chatbot LIVE!');
});
