-- clean_chips.sql — вычистить правила чипса (цвета и пометки) из базы.
--
-- ЗАЧЕМ ЧИСТИТЬ В ПЯТИ МЕСТАХ, А НЕ В ОДНОЙ ТАБЛИЦЕ
--
-- Правила лежат в chip_rules, но одну её чистить бесполезно: при каждом
-- старте приложение зовёт ensure_schema() (db.py) и переливает в chip_rules
-- через ON CONFLICT DO NOTHING из СТАРЫХ таблиц chip_colors и chip_marks.
-- Их когда-то намеренно не удалили — оставили как путь отката. Пока в них
-- есть строки, удалённое правило возвращается на первом же перезапуске.
-- Проверено: DELETE FROM chip_rules -> рестарт -> все 13 правил на месте.
--
-- Связи «номер ↔ правило» восстанавливаются оттуда же: chip_rule_links
-- доливается из chip_settings.color_code и из chip_mark_links.
--
-- Правка seeds.py на существующую базу не влияет вообще: сеялка умеет
-- только добавлять недостающее и никогда не удаляет, а в app_settings уже
-- стоит seeds_version = 1, из-за чего она и добавлять не пытается.
--
-- ПЕРЕД ЗАПУСКОМ
--   1. Остановить сервер: чистка в шести таблицах, и делать её одновременно
--      с работающим приложением незачем.
--   2. Снять резервную копию. Отката у этого скрипта нет:
--          pg_dump -U megafon -d megafon -f megafon.before-clean.sql
--
-- КАК ЗАПУСТИТЬ
--
--       psql -U megafon -d megafon -v ON_ERROR_STOP=1 -f clean_chips.sql
--
--   Ключ ON_ERROR_STOP обязателен: без него psql после ошибки продолжает
--   выполнять остальное, и чистка получится наполовину.

BEGIN;

-- Связи номеров с правилами. Идут первыми: на chip_rules они висят через
-- ON DELETE CASCADE, и порядок тут скорее для читаемости — так видно, что
-- именно удаляется, а не что удалилось само.
DELETE FROM chip_rule_links;

-- Старая таблица связей с пометками. Один из двух источников воскрешения.
DELETE FROM chip_mark_links;

-- Второй источник: цвет номера продублирован здесь. Не сбросить — миграция
-- при следующем старте перельёт его обратно в chip_rule_links.
-- 'normal' — значение по умолчанию, его же ставит delete_chip_rule().
UPDATE chip_settings SET color_code = 'normal';

-- Собственно правила.
DELETE FROM chip_rules;

-- Старые справочники, из которых идёт перелив. Без этих двух строк вся
-- работа выше отменяется на первом перезапуске приложения.
DELETE FROM chip_colors;
DELETE FROM chip_marks;

COMMIT;

-- Проверка: все пять чисел должны быть 0.
SELECT 'chip_rule_links' AS table_name, count(*) AS rows FROM chip_rule_links
UNION ALL SELECT 'chip_mark_links', count(*) FROM chip_mark_links
UNION ALL SELECT 'chip_rules',      count(*) FROM chip_rules
UNION ALL SELECT 'chip_colors',     count(*) FROM chip_colors
UNION ALL SELECT 'chip_marks',      count(*) FROM chip_marks;


-- ═══════════════════════════════════════════════════════════════════════
--  ВАРИАНТ «ОСТАВИТЬ ЧАСТЬ ПРАВИЛ»
--
--  Если сносить всё подчистую не надо — не запускай блок выше, а возьми
--  этот. Перечисли в трёх списках IN коды, которые остаются жить.
--  Списки должны совпадать, иначе правило останется без связей или,
--  наоборот, связь повиснет на удалённом правиле.
-- ═══════════════════════════════════════════════════════════════════════
--
-- BEGIN;
-- DELETE FROM chip_rule_links WHERE rule_code NOT IN ('normal');
-- DELETE FROM chip_mark_links WHERE mark_code NOT IN ('normal');
-- UPDATE chip_settings SET color_code = 'normal'
--  WHERE color_code IS NOT NULL AND color_code NOT IN ('normal');
-- DELETE FROM chip_rules  WHERE code NOT IN ('normal');
-- DELETE FROM chip_colors WHERE code NOT IN ('normal');
-- DELETE FROM chip_marks  WHERE code NOT IN ('normal');
-- COMMIT;
--
-- Посмотреть, что вообще есть, перед тем как выбирать:
--     SELECT code, kind, label, builtin FROM chip_rules ORDER BY kind, sort_order;
