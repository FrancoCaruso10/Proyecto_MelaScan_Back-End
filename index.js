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

// --- PACIENTES (solo médicos) ---
app.get('/pacientes', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'MEDICO') {
    return res.status(403).json({ error: 'Solo los médicos pueden ver esta lista' });
  }
  try {
    const { rows } = await pool.query('SELECT id, nombre FROM paciente ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DERMATOLOGOS (público: el paciente elige médico al registrarse) ---
app.get('/dermatologos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, especialidad FROM dermatologo ORDER BY nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ANALISIS (solo los tuyos) ---
app.get('/analisis', verificarToken, async (req, res) => {
  try {
    // El paciente ve los análisis donde él es el paciente; el médico, los que hizo
    const columna = req.usuario.rol === 'PACIENTE' ? 'paciente_id' : 'dermatologo_id';
    const { rows } = await pool.query(
      `SELECT id, paciente_id, dermatologo_id, resultado_ia, imagen_url, zona_cuerpo, sintomas, fecha
       FROM analisis WHERE ${columna} = $1 ORDER BY fecha DESC`,
      [req.usuario.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MENSAJES (solo los tuyos) ---
app.get('/mensajes', verificarToken, async (req, res) => {
  try {
    // El paciente ve los mensajes donde él es el paciente; el médico, los de sus pacientes
    const columna = req.usuario.rol === 'PACIENTE' ? 'paciente_id' : 'dermatologo_id';
    const { rows } = await pool.query(
      `SELECT id, paciente_id, dermatologo_id, emisor, texto, fecha_envio, leido
       FROM mensaje WHERE ${columna} = $1 ORDER BY fecha_envio ASC`,
      [req.usuario.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENVIAR MENSAJE (quién manda sale del token) ---
app.post('/mensajes', verificarToken, async (req, res) => {
  const { texto } = req.body;
  if (!texto) {
    return res.status(400).json({ error: 'Falta el texto del mensaje' });
  }

  try {
    let paciente_id;
    let dermatologo_id;

    if (req.usuario.rol === 'PACIENTE') {
      // El paciente le escribe a su médico asignado
      paciente_id = req.usuario.id;
      const p = await pool.query('SELECT dermatologo_id FROM paciente WHERE id = $1', [paciente_id]);
      dermatologo_id = p.rows[0] && p.rows[0].dermatologo_id;
      if (!dermatologo_id) {
        return res.status(400).json({ error: 'No tenés un médico asignado' });
      }
    } else {
      // El médico elige a qué paciente le escribe, pero solo a los suyos
      dermatologo_id = req.usuario.id;
      paciente_id = req.body.paciente_id;
      const p = await pool.query(
        'SELECT 1 FROM paciente WHERE id = $1 AND dermatologo_id = $2',
        [paciente_id, dermatologo_id]
      );
      if (p.rows.length === 0) {
        return res.status(403).json({ error: 'Ese paciente no es tuyo' });
      }
    }

    const { rows } = await pool.query(
      'INSERT INTO mensaje (paciente_id, dermatologo_id, emisor, texto, fecha_envio, leido) VALUES ($1, $2, $3, $4, NOW(), false) RETURNING *',
      [paciente_id, dermatologo_id, req.usuario.rol, texto]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- MARCAR MENSAJE COMO LEIDO (solo quien lo recibió) ---
app.patch('/mensajes/:id/leido', verificarToken, async (req, res) => {
  const { id } = req.params;

  // Si sos paciente, tus mensajes tienen tu id en paciente_id; si sos médico, en dermatologo_id
  const columna = req.usuario.rol === 'PACIENTE' ? 'paciente_id' : 'dermatologo_id';
  // Solo se marcan como leídos los que mandó la otra persona
  const otroRol = req.usuario.rol === 'PACIENTE' ? 'MEDICO' : 'PACIENTE';

  try {
    const { rows } = await pool.query(
      `UPDATE mensaje SET leido = true
       WHERE id = $1 AND ${columna} = $2 AND emisor = $3
       RETURNING *`,
      [id, req.usuario.id, otroRol]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- REGISTRO (el paciente puede elegir varios médicos) ---
app.post('/api/auth/register', async (req, res) => {
  const { nombre, email, contrasena, especialidad } = req.body;
  const rol = String(req.body.rol || '').toUpperCase();

  // Acepta una lista (dermatologo_ids) o un solo número (dermatologo_id)
  let medicos = Array.isArray(req.body.dermatologo_ids)
    ? req.body.dermatologo_ids
    : (req.body.dermatologo_id ? [req.body.dermatologo_id] : []);
  medicos = [...new Set(medicos.map(Number))]; // sin repetidos

  if (!nombre || !email || !contrasena || !['MEDICO', 'PACIENTE'].includes(rol)) {
    return res.status(400).json({ error: 'Faltan datos o el rol no es válido (MEDICO o PACIENTE)' });
  }
  if (contrasena.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (rol === 'MEDICO' && !especialidad) {
    return res.status(400).json({ error: 'Falta la especialidad' });
  }
  if (rol === 'PACIENTE' && (medicos.length === 0 || medicos.some((m) => !Number.isInteger(m)))) {
    return res.status(400).json({ error: 'Elegí al menos un médico (números de id)' });
  }

  const client = await pool.connect();
  try {
    const existente = await client.query(
      'SELECT 1 FROM paciente WHERE email = $1 UNION ALL SELECT 1 FROM dermatologo WHERE email = $1',
      [email]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    if (rol === 'PACIENTE') {
      // Chequeamos que todos los médicos elegidos existan
      const med = await client.query('SELECT id FROM dermatologo WHERE id = ANY($1::int[])', [medicos]);
      if (med.rows.length !== medicos.length) {
        return res.status(400).json({ error: 'Alguno de los médicos elegidos no existe' });
      }
    }

    const hash = await bcrypt.hash(contrasena, 10);

    if (rol === 'MEDICO') {
      const r = await client.query(
        'INSERT INTO dermatologo (nombre, email, contrasena, especialidad) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, especialidad',
        [nombre, email, hash, especialidad]
      );
      return res.status(201).json({ rol, ...r.rows[0] });
    }

    // Paciente: se guarda todo junto o no se guarda nada (transacción)
    await client.query('BEGIN');
    const p = await client.query(
      'INSERT INTO paciente (nombre, email, contrasena, dermatologo_id) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email',
      [nombre, email, hash, medicos[0]]
    );
    for (const m of medicos) {
      await client.query(
        'INSERT INTO paciente_dermatologo (paciente_id, dermatologo_id) VALUES ($1, $2)',
        [p.rows[0].id, m]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ rol, ...p.rows[0], dermatologo_ids: medicos });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

// --- GUARDIA: revisa la pulserita (token) ---
function verificarToken(req, res, next) {
  // La pulserita viaja en un encabezado que dice: Authorization: Bearer <token>
  const cabecera = req.headers.authorization || '';
  const [tipo, token] = cabecera.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el token. Iniciá sesión.' });
  }

  try {
    // Si la firma es falsa o venció, jwt.verify tira un error
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next(); // Todo bien: lo dejamos pasar al buzón
  } catch (err) {
    res.status(401).json({ error: 'Token inválido o vencido' });
  }
}

// --- QUIEN SOY (buzón de prueba para el guardia) ---
app.get('/api/yo', verificarToken, (req, res) => {
  res.json({ id: req.usuario.id, rol: req.usuario.rol });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

module.exports = app;
