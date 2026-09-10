const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Conexión a Neon PostgreSQL usando la variable DATABASE_URL de Vercel
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ruta raíz de prueba
app.get('/', (req, res) => {
  res.send('API de MelaScan corriendo correctamente en Vercel');
});

// Ruta de consulta a la tabla usuario
app.get('/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuario');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar la base de datos: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

module.exports = app;
