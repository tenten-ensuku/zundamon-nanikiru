import assert from 'node:assert/strict';
import test from 'node:test';
import {cleanAuthorComment, youtubeId} from '../scripts/clean-author-comments.mjs';
const ids = new Set(['sourceVideo', 'otherZundamon']);
const clean = (explanation, id=1) => cleanAuthorComment({id, explanation}, ids);

test('author cleanup removes ratings and known source URLs but retains explanation text', () => {
  assert.equal(clean('💯\nhttps://youtu.be/sourceVideo?si=abc').text, '');
  assert.equal(clean('💯\n打7m。\nhttps://www.youtube.com/watch?v=sourceVideo&t=30').text, '打7m。');
  assert.equal(clean('打7m。💯https://youtu.be/sourceVideo').text, '打7m。');
  assert.equal(clean('💯💯').removedRatings, 2);
  assert.equal(clean('100点').text, '');
  assert.equal(clean('１００点！').text, '');
});

test('author cleanup preserves other lessons, non-YouTube links and mahjong scores', () => {
  for (const text of ['https://youtu.be/referenceVideo', 'https://docs.google.com/document/d/lesson',
    'https://discord.com/channels/example', '1000点差。1100点。100点でも大切。', '  打7m。\n\n補足。  ']) {
    assert.equal(clean(text).text, text);
  }
  assert.equal(clean('https://youtu.be/otherZundamon').text, '');
  assert.equal(clean('[元動画](https://youtu.be/sourceVideo)').text, '');
  assert.equal(clean('<https://youtu.be/sourceVideo>').text, '');
});

test('only exact praise-only comments are cleared and mixed prose survives', () => {
  const praise='とじょ完全正解💯\nとじょ犬くんの完璧な解説を是非ご覧ください✨';
  assert.equal(clean(praise,38).text,'');
  assert.equal(clean(praise+'\n打7mの理由。',38).text,praise.replace('💯','')+'\n打7mの理由。');
  assert.equal(clean('||とじょくんの説明に付け足す事は何もありません。仕事泥棒！💯 ||\nhttps://youtu.be/sourceVideo',64).text,'');
  assert.equal(clean('💯\n||解説。💯||',34).text,'||解説。||');
});

test('URL matching is video-ID based, does not accept a lookalike host, and cleanup is idempotent', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=sourceVideo&list=abc'),'sourceVideo');
  assert.equal(youtubeId('https://youtube.com.evil.test/watch?v=sourceVideo'),null);
  const once=clean('💯\n打7m。\nhttps://youtu.be/sourceVideo').text;
  assert.equal(clean(once).text,once);
});
