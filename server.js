// server.js - Backend API cho game câu cá
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Cấu hình kết nối MySQL
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '123456', // Thay bằng mật khẩu MySQL của bạn
  database: 'fishing_game'
};

let pool;

// Khởi tạo database
async function initDatabase() {
  const connection = await mysql.createConnection({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password
  });

  // Tạo database nếu chưa có
  await connection.query('CREATE DATABASE IF NOT EXISTS fishing_game');
  await connection.end();

  // Tạo connection pool
  pool = mysql.createPool(dbConfig);

  // Tạo bảng users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tạo bảng game_data
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      money INT DEFAULT 0,
      fishing_rod VARCHAR(50) DEFAULT 'normal',
      owned_rods JSON,
      last_saved TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Tạo bảng inventory
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      fish_name VARCHAR(100) NOT NULL,
      rarity VARCHAR(50) NOT NULL,
      weight DECIMAL(4,1) NOT NULL,
      price INT NOT NULL,
      colour VARCHAR(20) NOT NULL,
      favourite BOOLEAN DEFAULT FALSE,
      caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log('✅ Database initialized successfully');
}

// API: Đăng ký
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Tên tài khoản phải có ít nhất 3 ký tự' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await pool.query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );

    const userId = result.insertId;

    // Tạo game data mặc định
    await pool.query(
      'INSERT INTO game_data (user_id, money, fishing_rod, owned_rods) VALUES (?, 0, "normal", ?)',
      [userId, JSON.stringify(['normal'])]
    );

    res.json({ success: true, userId, username });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Tên tài khoản đã tồn tại' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Lỗi server' });
    }
  }
});

// API: Đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không đúng' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không đúng' });
    }

    // Lấy game data
    const [gameData] = await pool.query(
      'SELECT * FROM game_data WHERE user_id = ?',
      [user.id]
    );

    // Lấy inventory
    const [inventory] = await pool.query(
      'SELECT * FROM inventory WHERE user_id = ? ORDER BY caught_at DESC',
      [user.id]
    );

    res.json({
      success: true,
      userId: user.id,
      username: user.username,
      gameData: gameData[0] || null,
      inventory: inventory
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API: Lưu game data
app.post('/api/save-game', async (req, res) => {
  try {
    const { userId, money, fishingRod, ownedRods } = req.body;

    await pool.query(
      `UPDATE game_data 
       SET money = ?, fishing_rod = ?, owned_rods = ? 
       WHERE user_id = ?`,
      [money, fishingRod, JSON.stringify(ownedRods), userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi lưu dữ liệu' });
  }
});

// API: Thêm cá vào inventory
app.post('/api/add-fish', async (req, res) => {
  try {
    const { userId, fish } = req.body;

    await pool.query(
      `INSERT INTO inventory (user_id, fish_name, rarity, weight, price, colour, favourite) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, fish.name, fish.rarity, fish.weight, fish.price, fish.color, false]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi thêm cá' });
  }
});

// API: Cập nhật favourite
app.post('/api/toggle-favourite', async (req, res) => {
  try {
    const { fishId, favourite } = req.body;

    await pool.query(
      'UPDATE inventory SET favourite = ? WHERE id = ?',
      [favourite, fishId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi cập nhật' });
  }
});

// API: Bán cá
app.post('/api/sell-fish', async (req, res) => {
  try {
    const { userId } = req.body;

    // Xóa các cá không được favourite
    const [result] = await pool.query(
      'DELETE FROM inventory WHERE user_id = ? AND favourite = FALSE',
      [userId]
    );

    res.json({ success: true, soldCount: result.affectedRows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Lỗi khi bán cá' });
  }
});

// Khởi động server
const PORT = 3001;
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('❌ Lỗi khởi tạo database:', err);
});