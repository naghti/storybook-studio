const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CAPTURE = Object.freeze({
  network: 'assets', timeoutMs: 60000, settleMs: 350, selector: 'body',
  readySelector: '', errorSelector: '', disableAnimations: true,
  failOnBrokenImages: true, allowMockHttpErrors: false,
  ignoreRequests: [], ignoreRequestFailures: [],
});

function captureSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('capture должен быть объектом');
  for (const key of Object.keys(value)) if (!Object.hasOwn(DEFAULT_CAPTURE, key)) throw new Error(`Неизвестная настройка capture.${key}`);
  const result = { ...DEFAULT_CAPTURE, ...value };
  if (!['assets', 'all', 'none'].includes(result.network)) throw new Error('capture.network: assets, all или none');
  for (const [key, min, max] of [['timeoutMs', 100, 300000], ['settleMs', 0, 30000]]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`capture.${key}: целое число от ${min} до ${max}`);
  }
  for (const key of ['selector', 'readySelector', 'errorSelector']) if (typeof result[key] !== 'string') throw new Error(`capture.${key} должен быть строкой`);
  if (!result.selector.trim()) throw new Error('capture.selector не может быть пустым');
  for (const key of ['disableAnimations', 'failOnBrokenImages', 'allowMockHttpErrors']) if (typeof result[key] !== 'boolean') throw new Error(`capture.${key} должен быть boolean`);
  for (const key of ['ignoreRequests', 'ignoreRequestFailures']) {
    if (!Array.isArray(result[key]) || result[key].some(v => typeof v !== 'string' || !v)) throw new Error(`capture.${key} должен быть массивом непустых регулярных выражений`);
    for (const pattern of result[key]) new RegExp(pattern);
  }
  return result;
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Конфиг должен экспортировать объект');
  for (const key of Object.keys(value)) if (!['version', 'capture', 'concurrency', 'threshold', 'prepare', 'stories'].includes(key)) throw new Error(`Неизвестная настройка: ${key}`);
  if (value.version !== 1) throw new Error('Конфиг должен содержать version: 1');
  if (value.prepare !== undefined && typeof value.prepare !== 'function') throw new Error('prepare должен быть функцией');
  const capture = captureSettings(value.capture);
  const concurrency = value.concurrency ?? 4, threshold = value.threshold ?? 0;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency: целое число от 1 до 16');
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('threshold: число от 0 до 1');
  const stories = value.stories ?? [];
  if (!Array.isArray(stories)) throw new Error('stories должен быть массивом');
  for (const rule of stories) {
    if (!rule || typeof rule.match !== 'string' || !rule.match) throw new Error('Каждое правило stories должно содержать match — регулярное выражение по ID');
    for (const key of Object.keys(rule)) if (!['match', 'capture', 'skip'].includes(key)) throw new Error(`Неизвестная настройка stories.${key}`);
    new RegExp(rule.match);
    captureSettings({ ...capture, ...rule.capture });
    if (rule.skip !== undefined && typeof rule.skip !== 'boolean') throw new Error('stories.skip должен быть boolean');
  }
  return { capture, concurrency, threshold, prepare: value.prepare, stories };
}

function loadConfig(project) {
  let file = project.configFile || '';
  if (!file && project.mode !== 'url') {
    file = ['storybook-studio.config.cjs', 'storybook-studio.config.json']
      .map(name => path.join(project.source, name)).find(candidate => fs.existsSync(candidate)) || '';
  }
  if (!file) return { ...validateConfig({ version: 1 }), file: null };
  try {
    if (!path.isAbsolute(file)) throw new Error('Нужен абсолютный путь к конфигу');
    if (!['.cjs', '.json'].includes(path.extname(file))) throw new Error('Поддерживаются .cjs и .json');
    let value;
    if (file.endsWith('.json')) value = JSON.parse(fs.readFileSync(file, 'utf8'));
    else { delete require.cache[require.resolve(file)]; value = require(file); }
    return { ...validateConfig(value), file };
  } catch (error) { throw new Error(`Конфиг ${file}: ${error.message}`); }
}

function storySettings(config, story) {
  let capture = { ...config.capture }, skip = story.parameters?.loki?.skip === true;
  for (const rule of config.stories) if (new RegExp(rule.match).test(story.id)) {
    capture = { ...capture, ...rule.capture };
    if (rule.skip !== undefined) skip = rule.skip;
  }
  return { capture: captureSettings(capture), skip };
}

function targetSettings(capture) {
  const join = values => values.length ? values.map(value => `(?:${value})`).join('|') : undefined;
  return {
    studioNetwork: capture.network, studioSettleMs: capture.settleMs,
    studioTimeoutMs: capture.timeoutMs, studioReadySelector: capture.readySelector,
    studioErrorSelector: capture.errorSelector, studioFailOnBrokenImages: capture.failOnBrokenImages,
    studioAllowMockHttpErrors: capture.allowMockHttpErrors,
    chromeEnableAnimations: !capture.disableAnimations,
    chromeRequestIgnore: join(capture.ignoreRequests), fetchFailIgnore: join(capture.ignoreRequestFailures),
  };
}
module.exports = { loadConfig, validateConfig, captureSettings, storySettings, targetSettings, DEFAULT_CAPTURE };
