require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const connectDB = require('./config/db');
const logger = require('./config/logger');
const { loadUser } = require('./middleware/auth');
const deviceId = require('./middleware/deviceId');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ---- View engine ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Body parsing & static files ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Sessions (stored in MongoDB so users stay logged in after a server restart) ----
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

app.use(deviceId);   // req.deviceId - anonymous id per browser (comment rate limit, viewed/unviewed)
app.use(loadUser);   // req.user + res.locals.user for the views

// ---- Routes: one file per area. Add new routes inside your own file, not here. ----
app.use('/', require('./routes/public'));             // member 1
app.use('/auth', require('./routes/auth'));           // member 2
app.use('/api/comments', require('./routes/comments')); // member 2
app.use('/api/users', require('./routes/users'));    // member 2
app.use('/reporter', require('./routes/reporter'));   // member 3
app.use('/editor', require('./routes/editor'));       // member 4

// ---- Errors ----
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => logger.info(`Server running on http://localhost:${PORT}`)))
  .catch((err) => {
    logger.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });
