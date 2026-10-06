require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ruta raíz
app.get('/', (req, res) => {
  res.send('API MelaScan lista y conectada a Neon PostgreSQL');
});

// --- USUARIOS ---
app.get('/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuario');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/usuarios', async (req, res) => {
  try {
    const { nombre, email } = req.body;
    const result = await pool.query(
      'INSERT INTO usuario (nombre, email) VALUES ($1, $2) RETURNING *',
      [nombre, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- OTRAS TABLAS (LECTURA) ---
app.get('/diagnosticos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM diagnosticos');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/imagenes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM imagenes');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/chats', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM chats');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

module.exports = app;
