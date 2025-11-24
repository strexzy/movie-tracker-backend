require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const cors = require("cors");
const helmet = require("helmet");
const axios = require("axios");

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const TMDB_API_KEY = process.env.API_KEY || "ERROR";

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT,
  ssl:
    process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

function sanitizeUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name || null,
    created_at: row.created_at,
  };
}

app.post(
  "/api/register",
  body("username").isLength({ min: 3 }).withMessage("username min 3 chars"),
  body("email").isEmail().withMessage("invalid email"),
  body("password").isLength({ min: 6 }).withMessage("password min 6 chars"),
  body("confirmPassword").exists(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { username, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword)
      return res.status(400).json({ message: "passwords do not match" });

    try {
      const { rows: userByUsername } = await pool.query(
        "SELECT id FROM users WHERE username = $1",
        [username],
      );
      if (userByUsername.length)
        return res.status(400).json({ message: "username already taken" });

      const { rows: userByEmail } = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      if (userByEmail.length)
        return res.status(400).json({ message: "email already used" });

      const password_hash = await bcrypt.hash(password, 12);
      const display_name = username;

      const insertQuery = `INSERT INTO users (username, email, password_hash, display_name) VALUES ($1,$2,$3,$4) RETURNING id, username, email, display_name, created_at`;
      const { rows } = await pool.query(insertQuery, [
        username,
        email,
        password_hash,
        display_name,
      ]);
      const user = rows[0];

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "1h",
      });

      return res.status(201).json({ user: sanitizeUser(user), token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "internal error" });
    }
  },
);

app.post(
  "/api/login",
  body("username").exists(),
  body("password").exists(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    try {
      const { rows } = await pool.query(
        "SELECT id, username, email, password_hash, display_name, created_at FROM users WHERE username = $1",
        [username],
      );
      if (!rows.length)
        return res.status(401).json({ message: "invalid credentials" });

      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ message: "invalid credentials" });

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "7d",
      });

      return res.json({ user: sanitizeUser(user), token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "internal error" });
    }
  },
);

async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).json({ message: "no token" });
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, username, email, display_name, created_at FROM users WHERE id = $1",
      [payload.userId],
    );
    if (!rows.length) return res.status(401).json({ message: "invalid token" });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: "invalid token" });
  }
}

app.get("/api/me", authMiddleware, (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

app.get("/api/movies/search", async (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ message: "query is required" });

  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      query,
    )}&language=ru`;

    const { data } = await axios.get(url);

    return res.json({
      results: data.results.map((m) => ({
        id: m.id,
        title: m.title,
        overview: m.overview,
        year: m.release_date?.split("-")[0],
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
      })),
    });
  } catch (e) {
    console.error("TMDB Search Error:", e.response?.data || e.message);
    return res.status(500).json({ message: "movies search failed" });
  }
});

app.get("/api/movies/trending", async (req, res) => {
  try {
    const url = `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=ru`;

    const { data } = await axios.get(url);

    return res.json({
      results: data.results.map((m) => ({
        id: m.id,
        title: m.title,
        overview: m.overview,
        year: m.release_date?.split("-")[0],
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
      })),
    });
  } catch (e) {
    console.error("TMDB Trending Error:", e.response?.data || e.message);
    return res.status(500).json({ message: "trending fetch failed" });
  }
});

app.get("/api/movies/details/:id", async (req, res) => {
  const movieId = req.params.id;

  try {
    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&language=ru`;

    const { data } = await axios.get(url);

    return res.json({
      id: data.id,
      title: data.title,
      overview: data.overview,
      year: data.release_date?.split("-")[0],
      poster: data.poster_path
        ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
        : null,
      genres: data.genres?.map((g) => g.name),
    });
  } catch (e) {
    console.error("TMDB Details Error:", e.response?.data || e.message);
    return res.status(500).json({ message: "movie details failed" });
  }
});

app.post("/api/movies/save", authMiddleware, async (req, res) => {
  const { movie_id, title, year, poster } = req.body;

  if (!movie_id || !title)
    return res.status(400).json({ message: "movie_id & title required" });

  try {
    const insert = `
      INSERT INTO saved_movies (user_id, movie_id, title, year, poster)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `;
    const { rows } = await pool.query(insert, [
      req.user.id,
      movie_id,
      title,
      year,
      poster,
    ]);

    return res.status(201).json({ movie: rows[0] });
  } catch (e) {
    console.error("Save Movie Error:", e);
    return res.status(500).json({ message: "save failed" });
  }
});

app.get("/api/mymovies", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM saved_movies WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id],
    );

    return res.json({ movies: rows });
  } catch (e) {
    console.error("Fetch Saved Error:", e);
    return res.status(500).json({ message: "fetch failed" });
  }
});

app.delete("/api/movies/:id", authMiddleware, async (req, res) => {
  const movieId = req.params.id;

  if (!movieId)
    return res.status(400).json({ message: "movie id is required" });

  try {
    const del = `
      DELETE FROM saved_movies
      WHERE user_id = $1 AND movie_id = $2
      RETURNING id
    `;
    const { rows } = await pool.query(del, [req.user.id, movieId]);

    if (!rows.length)
      return res.status(404).json({ message: "movie not found" });

    return res.json({ message: "movie removed" });
  } catch (e) {
    console.error("Delete Movie Error:", e);
    return res.status(500).json({ message: "delete failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
