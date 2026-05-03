const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// БД
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    // Таблица броней (userId = Telegram ID)
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        name TEXT,
        phone TEXT,
        date TEXT,
        time TEXT,
        guests INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Таблица бонусов (ключ — Telegram ID)
    db.run(`CREATE TABLE IF NOT EXISTS bonuses (
        userId INTEGER PRIMARY KEY,
        balance INTEGER DEFAULT 100
    )`);
    
    // История операций
    db.run(`CREATE TABLE IF NOT EXISTS bonus_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        amount INTEGER,
        reason TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Меню
    db.run(`CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        desc TEXT,
        price INTEGER,
        category TEXT
    )`);
    
    // Акции
    db.run(`CREATE TABLE IF NOT EXISTS promos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        desc TEXT,
        discount INTEGER,
        code TEXT
    )`);
    
    // Демо-данные
    db.get(`SELECT COUNT(*) as cnt FROM menu`, (err, row) => {
        if (row.cnt === 0) {
            db.run(`INSERT INTO menu (name, desc, price, category) VALUES 
                ('Цезарь с креветками', 'Салат, креветки, пармезан', 590, 'Салаты'),
                ('Борщ с пампушками', 'Классический украинский борщ', 390, 'Супы'),
                ('Рибай стейк', 'Мраморная говядина', 1890, 'Горячее'),
                ('Домашний лимонад', 'Имбирь, мята, лайм', 250, 'Напитки')`);
        }
    });
    
    db.get(`SELECT COUNT(*) as cnt FROM promos`, (err, row) => {
        if (row.cnt === 0) {
            db.run(`INSERT INTO promos (name, desc, discount, code) VALUES 
                ('Welcome', 'Скидка на первый заказ', 20, 'WELCOME20'),
                ('Счастливый час', 'С 15 до 17 часов', 15, 'HAPPY15'),
                ('День рождения', 'Именинникам скидка', 25, 'BIRTHDAY25')`);
        }
    });
});

// ========== API: привязка к Telegram ID ==========

// 1. Создать бронь
app.post('/api/bookings', (req, res) => {
    const userId = req.headers['x-telegram-user-id'];
    if (!userId) return res.status(401).json({ error: 'No Telegram ID' });
    
    const { name, phone, date, time, guests } = req.body;
    db.run(`INSERT INTO bookings (userId, name, phone, date, time, guests) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, name, phone, date, time, guests],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, status: 'pending' });
        });
});

// 2. Получить брони пользователя по Telegram ID
app.get('/api/bookings/user/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT * FROM bookings WHERE userId = ? ORDER BY date DESC`, [userId], (err, rows) => {
        res.json(rows || []);
    });
});

// 3. Количество броней (для уровня лояльности)
app.get('/api/bookings/count/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get(`SELECT COUNT(*) as count FROM bookings WHERE userId = ?`, [userId], (err, row) => {
        res.json({ count: row?.count || 0 });
    });
});

// 4. Меню
app.get('/api/menu', (req, res) => {
    db.all(`SELECT * FROM menu`, (err, rows) => res.json(rows));
});

// 5. Бонусы пользователя по Telegram ID
app.get('/api/bonuses/:userId', (req, res) => {
    const userId = req.params.userId;
    
    db.get(`SELECT balance FROM bonuses WHERE userId = ?`, [userId], (err, row) => {
        const balance = row ? row.balance : 100;
        
        // Если пользователя нет в таблице бонусов — создаём
        if (!row) {
            db.run(`INSERT INTO bonuses (userId, balance) VALUES (?, 100)`, [userId]);
        }
        
        db.all(`SELECT amount, reason, date FROM bonus_history WHERE userId = ? ORDER BY id DESC LIMIT 10`, 
            [userId], (err, history) => {
                res.json({ balance, history: history || [] });
            });
    });
});

// 6. Начислить бонусы
app.post('/api/bonuses/add', (req, res) => {
    const userId = req.headers['x-telegram-user-id'];
    const { amount, reason } = req.body;
    
    if (!userId) return res.status(401).json({ error: 'No user ID' });
    
    db.run(`INSERT INTO bonuses (userId, balance) VALUES (?, ?) 
            ON CONFLICT(userId) DO UPDATE SET balance = balance + ?`,
            [userId, amount, amount]);
    
    db.run(`INSERT INTO bonus_history (userId, amount, reason) VALUES (?, ?, ?)`,
            [userId, amount, reason]);
    
    res.json({ success: true });
});

// 7. Акции
app.get('/api/promos', (req, res) => {
    db.all(`SELECT * FROM promos`, (err, rows) => res.json(rows));
});

// Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер работает на порту ${PORT}`);
    console.log(`🔑 Пользователи идентифицируются по Telegram ID`);
});