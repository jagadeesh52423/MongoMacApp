const { MongoClient } = require('mongodb');
const fs = require('fs');

const uri = process.env.MONGO_URI;
if (!uri) {
  process.stderr.write(JSON.stringify({ __error: 'MONGO_URI env var is required' }) + '\n');
  process.exit(1);
}
const [dbName, scriptPath] = process.argv.slice(2);
const rawScript = fs.readFileSync(scriptPath, 'utf8');

let groupIndex = 0;

function emitGroup(docs) {
  const arr = Array.isArray(docs) ? docs : [docs];
  const safe = JSON.parse(JSON.stringify(arr, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && v._bsontype === 'ObjectId') return v.toString();
    return v;
  }));
  process.stdout.write(
    JSON.stringify({ __group: groupIndex++, docs: safe }) + '\n',
  );
}

// Transform Mongo shell-style script: add await before db. expressions so the
// user never needs to write await in their queries (Studio 3T / mongosh style).
function transformScript(script) {
  return script
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      const indent = line.slice(0, line.length - trimmed.length);

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return line;
      }

      // Leave control-flow and already-async lines alone
      if (/^(await|return|throw|if|else|for|while|switch|try|catch|finally|function|class|async)/.test(trimmed)) {
        return line;
      }

      // Standalone db. expression
      if (trimmed.startsWith('db.')) {
        return `${indent}await ${trimmed}`;
      }

      // Assignment: const/let/var x = db.col.method()
      const m = trimmed.match(/^((?:const|let|var)\s+\w+\s*=\s*)db\./);
      if (m) {
        return `${indent}${m[1]}await db.${trimmed.slice(m[1].length + 3)}`;
      }

      return line;
    })
    .join('\n');
}

// Wrap a Mongo cursor so users can chain modifiers (sort, limit, skip, ...)
// and also await/then the cursor directly to materialize results. emitGroup is
// invoked exactly once when the cursor is materialized.
function makeCursorProxy(cursor) {
  const modifiers = ['sort', 'limit', 'skip', 'project', 'hint', 'maxTimeMS', 'batchSize'];

  let promise;
  function materialize() {
    if (!promise) {
      promise = cursor.toArray().then((docs) => {
        emitGroup(docs);
        return docs;
      });
    }
    return promise;
  }

  const proxy = {
    then: (res, rej) => materialize().then(res, rej),
    catch: (rej) => materialize().catch(rej),
    finally: (fn) => materialize().finally(fn),
    toArray: () => materialize(),
  };

  modifiers.forEach((m) => {
    if (typeof cursor[m] === 'function') {
      proxy[m] = (...args) => {
        cursor = cursor[m](...args);
        return proxy;
      };
    }
  });

  return proxy;
}

function makeCollectionProxy(col) {
  return new Proxy(col, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];

      // Shell-compat alias: getIndexes() -> indexes()
      if (prop === 'getIndexes') {
        return () =>
          target.indexes().then((docs) => {
            emitGroup(docs);
            return docs;
          });
      }

      const val = target[prop];
      if (typeof val !== 'function') return val;

      // find/aggregate return chainable cursors
      if (prop === 'find' || prop === 'aggregate') {
        return (...args) => makeCursorProxy(val.call(target, ...args));
      }

      // All other methods: auto-capture Promise results
      return (...args) => {
        const op = val.call(target, ...args);
        if (!op) return op;
        if (typeof op.then === 'function') {
          return op.then((r) => { emitGroup(r === undefined ? null : r); return r; });
        }
        return op;
      };
    },
  });
}

function wrapDb(raw) {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'collection' || prop === 'getCollection') {
        return (n) => makeCollectionProxy(target.collection(n));
      }
      const val = target[prop];
      if (val === undefined && typeof prop === 'string' && !prop.startsWith('_')) {
        return makeCollectionProxy(target.collection(prop));
      }
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function extractLine(err) {
  const m = err.stack && err.stack.match(/<anonymous>:(\d+)/);
  return m ? parseInt(m[1], 10) - 1 : null;
}

async function run() {
  process.stderr.write(JSON.stringify({ __debug: `[harness] connecting to db=${dbName}` }) + '\n');
  const client = new MongoClient(uri);
  await client.connect();
  process.stderr.write(JSON.stringify({ __debug: `[harness] connected, running script` }) + '\n');
  const db = wrapDb(client.db(dbName));
  try {
    const userScript = transformScript(rawScript);
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn('db', 'print', userScript);
    const print = (v) => emitGroup(v);
    await fn(db, print);
    process.stderr.write(JSON.stringify({ __debug: `[harness] script complete, groups=${groupIndex}` }) + '\n');
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ __error: err.message, line: extractLine(err) }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
  process.exit(1);
});
