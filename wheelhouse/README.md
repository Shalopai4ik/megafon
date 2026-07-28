# wheelhouse — psycopg2 для закрытого контура

Драйвер PostgreSQL, собранный колесом под **Astra Linux, Python 3.11, x86_64**.
Лежит здесь, чтобы на боевой машине можно было поставить его **без интернета и
без компилятора** — одной командой из этой папки.

## Что внутри

```
psycopg2_binary-2.9.12-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
```

4.08 МБ, одно колесо. Больше ничего скачивать не нужно.

## Зависимостей нет вообще

У пакета **ни одной** зависимости на стороне Python:

```
Requires-Python: >=3.9
Requires-Dist:   (пусто)
```

Нативные библиотеки тоже не нужны — они уже лежат внутри колеса:

```
libpq-f521cc7d.so.5.17        клиент PostgreSQL
libssl-fe1b61af.so.3          TLS
libcrypto-88208852.so.3
libkrb5-fcafa220.so.3.3       Kerberos
libgssapi_krb5, libk5crypto, libkrb5support, libcom_err
libldap, liblber, libsasl2    LDAP-аутентификация
libselinux, libpcre, libcrypt, libkeyutils
```

То есть `apt install libpq-dev`, `gcc`, `python3-dev` на боевой машине
**не требуются**. Это и было главным условием: в контуре ставить нечего.

## Установка на боевой машине

Скопировать папку `wheelhouse` на машину и выполнить:

```bash
python3 -m pip install --no-index --find-links=./wheelhouse psycopg2-binary
```

`--no-index` запрещает pip лезть в интернет, `--find-links` говорит брать
только отсюда. Если в контуре pip настроен на внутреннее зеркало — флаги всё
равно нужны, иначе он пойдёт туда и может подтянуть другую сборку.

В виртуальное окружение — то же самое, просто из-под его python:

```bash
/opt/megafon/venv/bin/python -m pip install --no-index --find-links=./wheelhouse psycopg2-binary
```

## Проверка после установки

```bash
python3 -c "import psycopg2; print(psycopg2.__version__); print(psycopg2.extensions.libpq_version())"
```

Ожидаемый вывод — версия драйвера и версия вшитого libpq пятизначным числом
(`170000` и подобное). Если импорт прошёл — драйвер рабочий.

Проверка живого соединения с нашей базой:

```bash
python3 -c "
import psycopg2
c = psycopg2.connect(host='localhost', port=5434, dbname='megafon',
                     user='megafon', password='megafon')
print(c.execute if 0 else 'соединение установлено')
cur = c.cursor(); cur.execute('SELECT count(*) FROM reports'); print('reports:', cur.fetchone()[0])
"
```

## Ограничения сборки — прочитать до установки

**Архитектура — x86_64.** Колесо собрано под неё. На ARM или Эльбрусе оно
не встанет: pip скажет `not a supported wheel on this platform`. Проверить
целевую машину: `uname -m` — должно быть `x86_64`.

**Python — 3.11.** Тег `cp311` жёсткий: на 3.10 или 3.12 колесо не поставится.
Проверить: `python3 -V`.

**glibc — 2.17 и новее** (тег `manylinux_2_17`). У Astra Linux 1.7 это 2.28,
у 1.8 ещё новее, так что запас есть. Проверить: `ldd --version`.

## Как пересобрать под другую платформу

С машины с интернетом:

```bash
python -m pip download psycopg2-binary \
  --only-binary=:all: \
  --platform manylinux2014_x86_64 \
  --python-version 3.11 \
  --implementation cp \
  --abi cp311 \
  -d wheelhouse
```

Меняются три вещи: `--platform` (архитектура), `--python-version` и `--abi`
(версия питона). Например, под Python 3.12 — `--python-version 3.12 --abi cp312`.

## Почему psycopg2-binary, а не psycopg2

`psycopg2` из исходников требует на целевой машине `gcc`, `python3-dev` и
`libpq-dev`. В закрытом контуре их ставить неоткуда, и это ровно та причина,
по которой драйвер сюда до сих пор не заезжал.

У `psycopg2-binary` всё нужное вшито в колесо. Обычное возражение против него
в проде — конфликт вшитого OpenSSL с системным, если приложение в том же
процессе тянет TLS другой библиотекой. У нас такого нет: приложение работает
на стандартной библиотеке, других драйверов БД в процессе не живёт.

## Приложение на постгрес пока НЕ переключено

Колесо лежит в репозитории и готово к установке, но `db.py` по-прежнему
работает с SQLite. Само по себе появление драйвера ничего не меняет —
переключение это отдельная правка (`db.py`, плейсхолдеры `?` → `%s`,
строка подключения). Пока не сделано.
