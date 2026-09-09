CREATE TABLE IF NOT EXISTS zundamon_question_overrides (
  question_id INTEGER PRIMARY KEY CHECK(question_id BETWEEN 1 AND 9999),
  correct_discards TEXT NOT NULL CHECK(json_valid(correct_discards) AND json_type(correct_discards)='array' AND json_array_length(correct_discards)<=14),
  explanation TEXT NOT NULL CHECK(length(explanation)<=20000),
  question_data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(question_data) AND json_type(question_data)='object'),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zundamon_question_reviews (
  question_id INTEGER PRIMARY KEY CHECK(question_id BETWEEN 1 AND 9999),
  reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1)),
  review_status TEXT NOT NULL CHECK(review_status IN ('complete','check','fix')),
  updated_at TEXT NOT NULL,
  CHECK(reviewed = (review_status='complete'))
);
CREATE TABLE IF NOT EXISTS sync_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  revision INTEGER NOT NULL DEFAULT 0,
  write_day TEXT NOT NULL DEFAULT '',
  daily_mutations INTEGER NOT NULL DEFAULT 0,
  writes_enabled INTEGER NOT NULL DEFAULT 1 CHECK(writes_enabled IN(0,1))
);
INSERT OR IGNORE INTO sync_state(singleton) VALUES(1);
CREATE TABLE IF NOT EXISTS question_changes (
  question_id INTEGER PRIMARY KEY CHECK(question_id BETWEEN 1 AND 9999),
  revision INTEGER NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS overrides_insert_change AFTER INSERT ON zundamon_question_overrides BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT NEW.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
CREATE TRIGGER IF NOT EXISTS overrides_update_change AFTER UPDATE ON zundamon_question_overrides BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT NEW.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
CREATE TRIGGER IF NOT EXISTS overrides_delete_change AFTER DELETE ON zundamon_question_overrides BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT OLD.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
CREATE TRIGGER IF NOT EXISTS reviews_insert_change AFTER INSERT ON zundamon_question_reviews BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT NEW.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
CREATE TRIGGER IF NOT EXISTS reviews_update_change AFTER UPDATE ON zundamon_question_reviews BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT NEW.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
CREATE TRIGGER IF NOT EXISTS reviews_delete_change AFTER DELETE ON zundamon_question_reviews BEGIN
  SELECT RAISE(ABORT,'writes_disabled') WHERE (SELECT writes_enabled FROM sync_state WHERE singleton=1)=0;
  SELECT RAISE(ABORT,'daily_mutation_limit') WHERE (SELECT daily_mutations>=1000 AND write_day=date('now') FROM sync_state WHERE singleton=1);
  UPDATE sync_state SET revision=revision+1, daily_mutations=iif(write_day=date('now'),daily_mutations+1,1), write_day=date('now') WHERE singleton=1;
  INSERT INTO question_changes(question_id,revision) SELECT OLD.question_id,revision FROM sync_state WHERE singleton=1
    ON CONFLICT(question_id) DO UPDATE SET revision=excluded.revision;
END;
