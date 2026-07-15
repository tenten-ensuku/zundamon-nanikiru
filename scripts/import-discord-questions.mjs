import { appendFile, mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const QUESTIONS_DIR = path.join(PUBLIC_DIR, 'questions');
const OUTPUT_PATH = path.join(PUBLIC_DIR, 'questions.json');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_PATH = path.join(DATA_DIR, 'import-state.json');
const ERROR_LOG_PATH = path.join(DATA_DIR, 'import-errors.jsonl');
const API_BASE = 'https://discord.com/api/v10';

function usage() {
  console.log([
    'Usage:',
    '  node scripts/import-discord-questions.mjs --test newest [--limit 10]',
    '  node scripts/import-discord-questions.mjs --test oldest [--limit 10]',
    '  node scripts/import-discord-questions.mjs --all',
  ].join('\n'));
}

function parseArgs(argv) {
  const options = { mode: null, direction: 'newest', limit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.mode = 'all';
    else if (arg === '--test') {
      options.mode = 'test';
      if (argv[i + 1] === 'newest' || argv[i + 1] === 'oldest') options.direction = argv[++i];
    } else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.mode = 'help';
    else throw new Error('不明なオプションです: ' + arg);
  }
  if (options.mode === 'help') return options;
  if (!options.mode) throw new Error('--test または --all を指定してください。');
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('--limit は1以上の整数にしてください。');
  return options;
}

async function loadEnv() {
  try {
    const content = await readFile(path.join(ROOT, '.env'), 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!line || line.startsWith('#') || !match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function env(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error('.env の ' + name + ' を設定してください。');
  return value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class DiscordClient {
  constructor(token) {
    this.token = token;
    this.nextRequestAt = 0;
  }

  async get(apiPath) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const wait = this.nextRequestAt - Date.now();
      if (wait > 0) await sleep(wait);
      let response;
      try {
        response = await fetch(API_BASE + apiPath, {
          headers: { Authorization: 'Bot ' + this.token, 'User-Agent': 'zundamon-nanikiru-importer/1.0' },
        });
      } catch (error) {
        if (attempt === 8) throw error;
        await sleep(500 * attempt);
        continue;
      }

      const resetAfter = Number(response.headers.get('x-ratelimit-reset-after'));
      if (response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(resetAfter)) {
        this.nextRequestAt = Date.now() + Math.ceil(resetAfter * 1000) + 100;
      }
      if (response.status === 429) {
        const body = await response.json().catch(() => ({}));
        const waitMs = Math.max(250, Math.ceil(Number(body.retry_after || 1) * 1000) + 100);
        console.warn('Discordのレート制限です。' + (waitMs / 1000).toFixed(1) + '秒待機します。');
        this.nextRequestAt = Date.now() + waitMs;
        continue;
      }
      if (response.status >= 500 && attempt < 8) {
        await sleep(500 * attempt);
        continue;
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error('Discord API ' + response.status + ': ' + detail.slice(0, 500));
      }
      return response.json();
    }
    throw new Error('Discord APIの再試行回数を超えました。');
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(filePath + ' のJSONを読めません: ' + error.message);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rename(temporary, filePath);
      return;
    } catch (error) {
      const retryable = error && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
      if (!retryable || attempt === 8) throw error;
      // OneDriveやウイルス対策ソフトが置換先を一時的に掴む場合がある。
      await sleep(150 * attempt);
    }
  }
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isImage(attachment) {
  return attachment && (attachment.content_type && attachment.content_type.startsWith('image/')
    || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(attachment.filename || ''));
}

function imagesOf(message) {
  return (message.attachments || []).filter(isImage);
}

function snapshotMessagesOf(message) {
  return (message.message_snapshots || [])
    .map((snapshot) => snapshot && snapshot.message)
    .filter(Boolean);
}

function questionImagesOf(message) {
  const directImages = imagesOf(message);
  if (directImages.length) return directImages;
  return snapshotMessagesOf(message).flatMap(imagesOf);
}

function forwardedReferenceOf(message) {
  const reference = message.message_reference;
  if (String(reference && reference.type) !== '1') return null;
  if (!reference.channel_id || !reference.message_id) return null;
  return reference;
}

async function resolveSourceMessage(client, parent, defaultGuildId, defaultChannelId) {
  const reference = forwardedReferenceOf(parent);
  if (!reference) {
    return {
      message: parent,
      guildId: defaultGuildId,
      channelId: defaultChannelId,
      images: questionImagesOf(parent),
      forwarded: false,
    };
  }

  const source = await client.get('/channels/' + reference.channel_id + '/messages/' + reference.message_id);
  const sourceImages = imagesOf(source);
  const snapshotImages = questionImagesOf(parent);
  return {
    message: source,
    guildId: String(reference.guild_id || defaultGuildId),
    channelId: String(reference.channel_id),
    images: sourceImages.length ? sourceImages : snapshotImages,
    forwarded: true,
  };
}

function chronological(messages) {
  return [...messages].sort((a, b) => {
    const timeDifference = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return timeDifference || String(a.id).localeCompare(String(b.id));
  });
}

async function listMessages(client, channelId) {
  const all = [];
  let before = '';
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const page = await client.get('/channels/' + channelId + '/messages?' + query);
    all.push(...page);
    before = page.length === 100 ? page.at(-1).id : '';
  } while (before);
  return all;
}

async function download(attachment, localPath) {
  if (await exists(localPath)) return;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error('画像取得HTTP ' + response.status);
      const temporary = localPath + '.' + process.pid + '.tmp';
      await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      await rename(temporary, localPath);
      return;
    } catch (error) {
      if (attempt === 3) throw new Error('画像 ' + (attachment.filename || attachment.id) + ' を保存できません: ' + error.message);
      await sleep(400 * attempt);
    }
  }
}

function imageNames(questionId, count) {
  const prefix = 'question-' + String(questionId).padStart(3, '0');
  return Array.from({ length: count }, (_, index) => prefix + (index ? '-' + String(index + 1).padStart(2, '0') : '') + '.png');
}

async function logError(context, error) {
  await mkdir(DATA_DIR, { recursive: true });
  const record = {
    at: new Date().toISOString(),
    ...context,
    error: error instanceof Error ? error.message : String(error),
  };
  await appendFile(ERROR_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'help') return usage();
  await loadEnv();

  const config = {
    token: env('DISCORD_BOT_TOKEN'),
    guildId: env('DISCORD_GUILD_ID'),
    channelId: env('DISCORD_CHANNEL_ID'),
    explainerUserId: env('DISCORD_EXPLAINER_USER_ID'),
  };
  await mkdir(QUESTIONS_DIR, { recursive: true });

  const client = new DiscordClient(config.token);
  console.log('親チャンネルを走査しています…');
  const parentMessages = await listMessages(client, config.channelId);
  // Discordの転送メッセージでは、画像は親メッセージ直下ではなく
  // message_snapshots[].message.attachments に格納される。
  const allQuestions = chronological(parentMessages.filter((message) => questionImagesOf(message).length > 0));
  const numbered = allQuestions.map((message, index) => ({ message, id: index + 1 }));
  const selected = options.mode === 'all'
    ? numbered
    : options.direction === 'oldest'
      ? numbered.slice(0, options.limit)
      : numbered.slice(-options.limit);
  console.log('画像付き親投稿 ' + allQuestions.length + '件中、' + selected.length + '件を処理します。');

  const records = await readJson(OUTPUT_PATH, []);
  if (!Array.isArray(records)) throw new Error(OUTPUT_PATH + ' は配列JSONである必要があります。');
  const saved = new Map(records.map((record) => [String(record.discordMessageId), record]));
  const state = await readJson(STATE_PATH, { version: 1, completedParentMessageIds: [], failedParentMessageIds: [] });
  const completed = new Set(state.completedParentMessageIds || []);
  const failed = new Set(state.failedParentMessageIds || []);

  for (const question of selected) {
    const parent = question.message;
    const parentMessageId = String(parent.id);
    try {
      const forwardedReference = forwardedReferenceOf(parent);
      const expectedSourceMessageId = String(forwardedReference && forwardedReference.message_id || parentMessageId);
      if (saved.has(expectedSourceMessageId)) {
        completed.add(parentMessageId);
        failed.delete(parentMessageId);
        console.log('[' + question.id + '] 保存済みのためスキップ');
        continue;
      }

      const source = await resolveSourceMessage(client, parent, config.guildId, config.channelId);
      const sourceMessage = source.message;
      const sourceMessageId = String(sourceMessage.id);

      // A normal Discord thread uses its starter message ID as the thread channel ID.
      // Prefer the explicit field when Discord returns it, then use that guaranteed fallback.
      const threadId = String(sourceMessage.thread && sourceMessage.thread.id || sourceMessageId);
      const threadMessages = chronological(await listMessages(client, threadId));
      const explanation = threadMessages
        .filter((message) => String(message.author && message.author.id) === config.explainerUserId)
        .map((message) => message.content && message.content.trim())
        .filter(Boolean)
        .join('\n');

      const attachments = source.images;
      if (!attachments.length) throw new Error('画像を取得できません。');
      const names = imageNames(question.id, attachments.length);
      for (let index = 0; index < attachments.length; index += 1) {
        await download(attachments[index], path.join(QUESTIONS_DIR, names[index]));
      }
      const imagePaths = names.map((name) => '/questions/' + name);
      const record = {
        id: question.id,
        image: imagePaths[0],
        images: imagePaths,
        explanation,
        discordMessageUrl: 'https://discord.com/channels/' + source.guildId + '/' + source.channelId + '/' + sourceMessageId,
        discordMessageId: sourceMessageId,
        threadId,
        createdAt: sourceMessage.timestamp,
        hand: [],
        draw: null,
        status: 'unreviewed',
      };
      records.push(record);
      records.sort((a, b) => Number(a.id) - Number(b.id));
      await writeJson(OUTPUT_PATH, records);
      saved.set(sourceMessageId, record);
      completed.add(parentMessageId);
      failed.delete(parentMessageId);
      console.log('[' + question.id + '] 保存完了 (' + attachments.length + '画像 / 解説' + (explanation ? 'あり' : 'なし') + ')');
    } catch (error) {
      failed.add(parentMessageId);
      await logError({ questionId: question.id, parentMessageId }, error);
      console.error('[' + question.id + '] 失敗。ログへ記録して続行します: ' + error.message);
    } finally {
      state.version = 1;
      state.updatedAt = new Date().toISOString();
      state.channelId = config.channelId;
      state.lastRun = { mode: options.mode, direction: options.direction, selectedCount: selected.length };
      state.completedParentMessageIds = [...completed];
      state.failedParentMessageIds = [...failed];
      await writeJson(STATE_PATH, state);
    }
  }
  console.log('完了: 保存済み ' + records.length + '件 / 未解決エラー ' + failed.size + '件');
  if (failed.size) process.exitCode = 1;
}

main().catch((error) => {
  console.error('取込を開始できません: ' + error.message);
  process.exitCode = 1;
});
