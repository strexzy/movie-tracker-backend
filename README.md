SQL (создать таблицу users):

-- PostgreSQL
CREATE TABLE users (
id SERIAL PRIMARY KEY,
username VARCHAR(50) NOT NULL UNIQUE,
email VARCHAR(255) NOT NULL UNIQUE,
password_hash VARCHAR(255) NOT NULL,
display_name VARCHAR(100),
created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

Запуск:
node server.js

// =========================
// Movies API (TMDB)
// =========================

// ---- SEARCH MOVIES ----
// GET /api/movies/search?query=matrix

// =========================
// TRENDING MOVIES (TMDB)
// =========================

// GET /api/movies/trending

// ---- MOVIE DETAILS ----
// GET /api/movies/:id

// ---- SAVE MOVIE ----
// POST /api/movies/save

// ---- GET USER'S SAVED MOVIES ----
// GET /api/mymovies

// =========================
// REMOVE SAVED MOVIE
// =========================

// DELETE /api/movies/:id
// где :id — это movie_id (TMDB ID)
