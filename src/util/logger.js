const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let current = LEVELS[process.env.SEO2API_LOG_LEVEL] || LEVELS.info;

const stamp = () => new Date().toISOString();
const emit = (level, args) => {
  if (LEVELS[level] < current) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)}`;
  if (level === 'error' || level === 'warn') console.error(line, ...args);
  else console.log(line, ...args);
};

export const logger = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
  setLevel: (name) => { if (LEVELS[name]) current = LEVELS[name]; },
};
