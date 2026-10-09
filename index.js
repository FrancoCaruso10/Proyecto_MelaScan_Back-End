require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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

// --- MARCAR MENSAJE COMO LEIDO ---
app.patch('/mensajes/:id/leido', async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      'UPDATE mensaje SET leido = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- REGISTRO ---
app.post('/api/auth/register', async (req, res) => {
  const { nombre, email, contrasena, especialidad, dermatologo_id } = req.body;
  const rol = String(req.body.rol || '').toUpperCase();

  if (!nombre || !email || !contrasena || !['MEDICO', 'PACIENTE'].includes(rol)) {
    return res.status(400).json({ error: 'Faltan datos o el rol no es válido (MEDICO o PACIENTE)' });
  }
  if (contrasena.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (rol === 'MEDICO' && !especialidad) {
    return res.status(400).json({ error: 'Falta la especialidad' });
  }
  if (rol === 'PACIENTE' && !dermatologo_id) {
    return res.status(400).json({ error: 'Falta el médico asignado' });
  }

  try {
    const existente = await pool.query(
      'SELECT 1 FROM paciente WHERE email = $1 UNION ALL SELECT 1 FROM dermatologo WHERE email = $1',
      [email]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    const hash = await bcrypt.hash(contrasena, 10);

    let resultado;
    if (rol === 'MEDICO') {
      resultado = await pool.query(
        'INSERT INTO dermatologo (nombre, email, contrasena, especialidad) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, especialidad',
        [nombre, email, hash, especialidad]
      );
    } else {
      resultado = await pool.query(
        'INSERT INTO paciente (nombre, email, contrasena, dermatologo_id) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, dermatologo_id',
        [nombre, email, hash, dermatologo_id]
      );
    }

    res.status(201).json({ rol, ...resultado.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LOGIN ---
app.post('/api/auth/login', async (req, res) => {
  const { email, contrasena } = req.body;

  if (!email || !contrasena) {
    return res.status(400).json({ error: 'Faltan el email o la contraseña' });
  }

  try {
    // Buscamos el email primero entre los pacientes y después entre los médicos
    let rol = 'PACIENTE';
    let consulta = await pool.query(
      'SELECT id, nombre, email, contrasena FROM paciente WHERE email = $1',
      [email]
    );
    if (consulta.rows.length === 0) {
      rol = 'MEDICO';
      consulta = await pool.query(
        'SELECT id, nombre, email, contrasena FROM dermatologo WHERE email = $1',
        [email]
      );
    }

    const usuario = consulta.rows[0];
    // Mismo mensaje si no existe el email o si la clave está mal, para no dar pistas
    const valida = usuario ? await bcrypt.compare(contrasena, usuario.contrasena) : false;
    if (!valida) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Armamos la "pulserita": guarda quién sos y vence en 8 horas
    const token = jwt.sign(
      { id: usuario.id, rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, rol, id: usuario.id, nombre: usuario.nombre, email: usuario.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

module.exports = app;
