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

// --- PACIENTES ---
app.get('/pacientes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, dermatologo_id FROM paciente'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DERMATOLOGOS ---
app.get('/dermatologos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, especialidad FROM dermatologo'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ANALISIS ---
app.get('/analisis', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, paciente_id, dermatologo_id, resultado_ia, imagen_url, zona_cuerpo, sintomas, fecha FROM analisis ORDER BY fecha DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MENSAJES ---
app.get('/mensajes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, paciente_id, dermatologo_id, emisor, texto, fecha_envio, leido FROM mensaje ORDER BY fecha_envio ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENVIAR MENSAJE ---
app.post('/mensajes', async (req, res) => {
  const { paciente_id, dermatologo_id, emisor, texto } = req.body;

  if (!paciente_id || !dermatologo_id || !texto || !['MEDICO', 'PACIENTE'].includes(emisor)) {
    return res.status(400).json({ error: 'Faltan datos o el emisor no es válido (MEDICO o PACIENTE)' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO mensaje (paciente_id, dermatologo_id, emisor, texto, fecha_envio, leido) VALUES ($1, $2, $3, $4, NOW(), false) RETURNING *',
      [paciente_id, dermatologo_id, emisor, texto]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

module.exports = app;
