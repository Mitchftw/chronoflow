const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Todo Time Tracker', 'databases', 'todo-tracker.dev.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  
  db.all('SELECT * FROM time_entries', [], (err, entries) => {
    if (err) {
      console.error('Error querying time_entries:', err);
      return;
    }
    console.log('--- Time Entries ---');
    console.log(JSON.stringify(entries, null, 2));
    
    db.all('SELECT * FROM issues', [], (err, issues) => {
      if (err) {
        console.error('Error querying issues:', err);
        return;
      }
      console.log('--- Issues ---');
      console.log(JSON.stringify(issues, null, 2));
      db.close();
    });
  });
});
