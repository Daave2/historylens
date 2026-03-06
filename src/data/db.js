import Dexie from 'dexie';

const db = new Dexie('HistoryLensDB');

db.version(1).stores({
  projects: 'id, name, createdAt',
  places:   'id, projectId, name, category, createdAt',
  timeEntries: 'id, placeId, yearStart, yearEnd, confidence, createdAt',
  images:   'id, timeEntryId, yearTaken'
});

export default db;
