import * as SQLite from 'expo-sqlite';

export interface LocationRecord {
  id?: number;
  user_uid: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  synced: boolean;
}

export interface WorkAllocationShift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface WorkAllocationArea {
  id: number;
  name: string;
  longtitude: string;
  latitude: string;
}

export interface WorkAllocationBlock {
  id: number;
  name: string;
}

export interface WorkAllocation {
  id: number;
  shift: WorkAllocationShift;
  area: WorkAllocationArea;
  block: WorkAllocationBlock | null;
}

let db: SQLite.SQLiteDatabase | null = null;

// Open database synchronously for background task compatibility
export function openDatabaseSync(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('siaga_kebun.db');
    // Create tables using sync API
    db.execSync(`
      CREATE TABLE IF NOT EXISTS location_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_uid TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        recorded_at TEXT NOT NULL,
        synced INTEGER DEFAULT 0
      );
    `);

    // Create work allocations table
    db.execSync(`
      CREATE TABLE IF NOT EXISTS work_allocations (
        id INTEGER PRIMARY KEY,
        user_uid TEXT NOT NULL,
        allocation_date TEXT NOT NULL,
        shift_id INTEGER NOT NULL,
        shift_name TEXT NOT NULL,
        shift_start_time TEXT NOT NULL,
        shift_end_time TEXT NOT NULL,
        area_id INTEGER NOT NULL,
        area_name TEXT NOT NULL,
        area_longitude TEXT,
        area_latitude TEXT,
        block_id INTEGER,
        block_name TEXT
      );
    `);

    // Create checkin status table for offline support
    db.execSync(`
      CREATE TABLE IF NOT EXISTS checkin_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_uid TEXT NOT NULL,
        status_date TEXT NOT NULL,
        check_in INTEGER DEFAULT 0,
        check_out INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(user_uid, status_date)
      );
    `);
  }
  return db;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  try {
    return openDatabaseSync();
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return openDatabaseSync();
}

// Sync version for background tasks
export function insertLocationRecordSync(record: Omit<LocationRecord, 'id'>): number {
  const database = openDatabaseSync();
  const result = database.runSync(
    `INSERT INTO location_records (user_uid, latitude, longitude, recorded_at, synced)
     VALUES (?, ?, ?, ?, ?)`,
    [record.user_uid, record.latitude, record.longitude, record.recorded_at, record.synced ? 1 : 0]
  );
  return result.lastInsertRowId;
}

// Async version for regular app usage
export async function insertLocationRecord(record: Omit<LocationRecord, 'id'>): Promise<number> {
  return insertLocationRecordSync(record);
}

export function getLocationRecordsSync(
  userUid: string,
  limit: number = 20,
  offset: number = 0
): LocationRecord[] {
  const database = openDatabaseSync();
  const records = database.getAllSync<{
    id: number;
    user_uid: string;
    latitude: number;
    longitude: number;
    recorded_at: string;
    synced: number;
  }>(
    `SELECT * FROM location_records 
     WHERE user_uid = ? 
     ORDER BY recorded_at DESC 
     LIMIT ? OFFSET ?`,
    [userUid, limit, offset]
  );

  return records.map((record) => ({
    ...record,
    synced: record.synced === 1,
  }));
}

export async function getLocationRecords(
  userUid: string,
  limit: number = 20,
  offset: number = 0
): Promise<LocationRecord[]> {
  return getLocationRecordsSync(userUid, limit, offset);
}

export function getUnsyncedLocationRecordsSync(userUid: string): LocationRecord[] {
  const database = openDatabaseSync();
  const records = database.getAllSync<{
    id: number;
    user_uid: string;
    latitude: number;
    longitude: number;
    recorded_at: string;
    synced: number;
  }>(
    `SELECT * FROM location_records 
     WHERE user_uid = ? AND synced = 0 
     ORDER BY recorded_at ASC`,
    [userUid]
  );

  return records.map((record) => ({
    ...record,
    synced: false,
  }));
}

export async function getUnsyncedLocationRecords(userUid: string): Promise<LocationRecord[]> {
  return getUnsyncedLocationRecordsSync(userUid);
}

export function markRecordsAsSyncedSync(ids: number[]): void {
  if (ids.length === 0) return;

  const database = openDatabaseSync();
  const placeholders = ids.map(() => '?').join(',');
  database.runSync(`UPDATE location_records SET synced = 1 WHERE id IN (${placeholders})`, ids);
}

export async function markRecordsAsSynced(ids: number[]): Promise<void> {
  markRecordsAsSyncedSync(ids);
}

export function getUnsyncedCountSync(userUid: string): number {
  const database = openDatabaseSync();
  const result = database.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM location_records WHERE user_uid = ? AND synced = 0`,
    [userUid]
  );
  return result?.count ?? 0;
}

export async function getUnsyncedCount(userUid: string): Promise<number> {
  return getUnsyncedCountSync(userUid);
}

export async function getLocationRecordsCount(userUid: string): Promise<number> {
  const database = openDatabaseSync();
  const result = database.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM location_records WHERE user_uid = ?`,
    [userUid]
  );
  return result?.count ?? 0;
}

export async function clearAllRecords(): Promise<void> {
  const database = openDatabaseSync();
  database.runSync(`DELETE FROM location_records`);
}

// Delete all synced records to optimize storage
export function deleteSyncedRecordsSync(userUid: string): number {
  const database = openDatabaseSync();
  const result = database.runSync(
    `DELETE FROM location_records WHERE user_uid = ? AND synced = 1`,
    [userUid]
  );
  return result.changes;
}

export async function deleteSyncedRecords(userUid: string): Promise<number> {
  return deleteSyncedRecordsSync(userUid);
}

// Work Allocation functions

// Get today's date as string (YYYY-MM-DD)
function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Save work allocations to local database
export async function saveWorkAllocations(
  userUid: string,
  allocations: WorkAllocation[]
): Promise<void> {
  const database = openDatabaseSync();
  const today = getTodayDateString();

  // Clear old allocations for this user and today
  database.runSync(`DELETE FROM work_allocations WHERE user_uid = ? AND allocation_date = ?`, [
    userUid,
    today,
  ]);

  // Insert new allocations
  for (const allocation of allocations) {
    database.runSync(
      `INSERT INTO work_allocations 
       (id, user_uid, allocation_date, shift_id, shift_name, shift_start_time, shift_end_time,
        area_id, area_name, area_longitude, area_latitude, block_id, block_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        allocation.id,
        userUid,
        today,
        allocation.shift.id,
        allocation.shift.name,
        allocation.shift.start_time,
        allocation.shift.end_time,
        allocation.area.id,
        allocation.area.name,
        allocation.area.longtitude,
        allocation.area.latitude,
        allocation.block?.id ?? null,
        allocation.block?.name ?? null,
      ]
    );
  }
}

// Get work allocations from local database
export async function getWorkAllocations(userUid: string): Promise<WorkAllocation[]> {
  const database = openDatabaseSync();
  const today = getTodayDateString();

  const records = database.getAllSync<{
    id: number;
    shift_id: number;
    shift_name: string;
    shift_start_time: string;
    shift_end_time: string;
    area_id: number;
    area_name: string;
    area_longitude: string;
    area_latitude: string;
    block_id: number | null;
    block_name: string | null;
  }>(`SELECT * FROM work_allocations WHERE user_uid = ? AND allocation_date = ?`, [userUid, today]);

  return records.map((record) => ({
    id: record.id,
    shift: {
      id: record.shift_id,
      name: record.shift_name,
      start_time: record.shift_start_time,
      end_time: record.shift_end_time,
    },
    area: {
      id: record.area_id,
      name: record.area_name,
      longtitude: record.area_longitude,
      latitude: record.area_latitude,
    },
    block:
      record.block_id !== null
        ? {
            id: record.block_id,
            name: record.block_name!,
          }
        : null,
  }));
}

// Clear old work allocations (older than today)
export async function clearOldWorkAllocations(): Promise<void> {
  const database = openDatabaseSync();
  const today = getTodayDateString();
  database.runSync(`DELETE FROM work_allocations WHERE allocation_date < ?`, [today]);
}

// Checkin Status functions for offline support

export interface CheckinStatus {
  check_in: boolean;
  check_out: boolean;
}

// Save checkin status to local database
export function saveCheckinStatusSync(userUid: string, status: CheckinStatus): void {
  const database = openDatabaseSync();
  const today = getTodayDateString();
  const now = new Date().toISOString();

  database.runSync(
    `INSERT OR REPLACE INTO checkin_status (user_uid, status_date, check_in, check_out, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userUid, today, status.check_in ? 1 : 0, status.check_out ? 1 : 0, now]
  );
}

export async function saveCheckinStatus(userUid: string, status: CheckinStatus): Promise<void> {
  saveCheckinStatusSync(userUid, status);
}

// Get checkin status from local database (sync version for background tasks)
export function getCheckinStatusSync(userUid: string): CheckinStatus | null {
  const database = openDatabaseSync();
  const today = getTodayDateString();

  const result = database.getFirstSync<{
    check_in: number;
    check_out: number;
  }>(`SELECT check_in, check_out FROM checkin_status WHERE user_uid = ? AND status_date = ?`, [
    userUid,
    today,
  ]);

  if (!result) return null;

  return {
    check_in: result.check_in === 1,
    check_out: result.check_out === 1,
  };
}

export async function getCheckinStatus(userUid: string): Promise<CheckinStatus | null> {
  return getCheckinStatusSync(userUid);
}

// Update only check_in status
export function updateCheckinSync(userUid: string, checkIn: boolean): void {
  const database = openDatabaseSync();
  const today = getTodayDateString();
  const now = new Date().toISOString();

  // First try to update existing record
  const existing = getCheckinStatusSync(userUid);
  if (existing) {
    database.runSync(
      `UPDATE checkin_status SET check_in = ?, updated_at = ? WHERE user_uid = ? AND status_date = ?`,
      [checkIn ? 1 : 0, now, userUid, today]
    );
  } else {
    // Insert new record
    database.runSync(
      `INSERT INTO checkin_status (user_uid, status_date, check_in, check_out, updated_at)
       VALUES (?, ?, ?, 0, ?)`,
      [userUid, today, checkIn ? 1 : 0, now]
    );
  }
}

// Update only check_out status
export function updateCheckoutSync(userUid: string, checkOut: boolean): void {
  const database = openDatabaseSync();
  const today = getTodayDateString();
  const now = new Date().toISOString();

  // First try to update existing record
  const existing = getCheckinStatusSync(userUid);
  if (existing) {
    database.runSync(
      `UPDATE checkin_status SET check_out = ?, updated_at = ? WHERE user_uid = ? AND status_date = ?`,
      [checkOut ? 1 : 0, now, userUid, today]
    );
  } else {
    // Insert new record (should not happen normally, but handle it)
    database.runSync(
      `INSERT INTO checkin_status (user_uid, status_date, check_in, check_out, updated_at)
       VALUES (?, ?, 0, ?, ?)`,
      [userUid, today, checkOut ? 1 : 0, now]
    );
  }
}

// Clear old checkin status (older than today)
export async function clearOldCheckinStatus(): Promise<void> {
  const database = openDatabaseSync();
  const today = getTodayDateString();
  database.runSync(`DELETE FROM checkin_status WHERE status_date < ?`, [today]);
}

// Dangerous Area types and functions

export interface DangerousAreaUser {
  uid: string;
  name: string;
  username: string;
  phone: string;
  email: string;
  level: string;
}

export interface DangerousAreaArea {
  id: number;
  name: string;
  longtitude: string;
  latitude: string;
}

export interface DangerousArea {
  id?: number;
  local_id?: number;
  user_uid: string;
  area_id: number;
  name: string;
  latitude: string;
  longitude: string;
  photo: string;
  risk: 'low' | 'medium' | 'high';
  synced: boolean;
  created_at: string;
  user?: DangerousAreaUser;
  area?: DangerousAreaArea;
}

// Initialize dangerous areas table
export function initDangerousAreasTable(): void {
  const database = openDatabaseSync();
  database.execSync(`
    CREATE TABLE IF NOT EXISTS dangerous_areas (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id INTEGER,
      user_uid TEXT NOT NULL,
      area_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      latitude TEXT NOT NULL,
      longitude TEXT NOT NULL,
      photo TEXT NOT NULL,
      risk TEXT NOT NULL CHECK(risk IN ('low', 'medium', 'high')),
      synced INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      user_name TEXT,
      user_username TEXT,
      user_phone TEXT,
      user_email TEXT,
      user_level TEXT,
      area_name TEXT,
      area_longitude TEXT,
      area_latitude TEXT
    );
  `);
}

// Save dangerous areas from server (replace all synced data)
export function saveDangerousAreasFromServer(areas: DangerousArea[]): void {
  const database = openDatabaseSync();
  initDangerousAreasTable();

  // Delete all synced areas (keep unsynced local ones)
  database.runSync(`DELETE FROM dangerous_areas WHERE synced = 1`);

  // Insert new areas from server
  for (const area of areas) {
    database.runSync(
      `INSERT INTO dangerous_areas 
       (id, user_uid, area_id, name, latitude, longitude, photo, risk, synced, created_at,
        user_name, user_username, user_phone, user_email, user_level,
        area_name, area_longitude, area_latitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        area.id ?? null,
        area.user_uid,
        area.area_id,
        area.name,
        area.latitude,
        area.longitude,
        area.photo,
        area.risk,
        area.created_at,
        area.user?.name ?? null,
        area.user?.username ?? null,
        area.user?.phone ?? null,
        area.user?.email ?? null,
        area.user?.level ?? null,
        area.area?.name ?? null,
        area.area?.longtitude ?? null,
        area.area?.latitude ?? null,
      ]
    );
  }
}

// Insert a new local dangerous area (unsynced)
export function insertLocalDangerousArea(
  area: Omit<DangerousArea, 'local_id' | 'id' | 'synced'>
): number {
  const database = openDatabaseSync();
  initDangerousAreasTable();

  const result = database.runSync(
    `INSERT INTO dangerous_areas 
     (user_uid, area_id, name, latitude, longitude, photo, risk, synced, created_at,
      user_name, user_username, user_phone, user_email, user_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      area.user_uid,
      area.area_id,
      area.name,
      area.latitude,
      area.longitude,
      area.photo,
      area.risk,
      area.created_at,
      area.user?.name ?? null,
      area.user?.username ?? null,
      area.user?.phone ?? null,
      area.user?.email ?? null,
      area.user?.level ?? null,
    ]
  );
  return result.lastInsertRowId;
}

// Get all dangerous areas (both synced and unsynced)
export function getAllDangerousAreas(): DangerousArea[] {
  const database = openDatabaseSync();
  initDangerousAreasTable();

  const records = database.getAllSync<{
    local_id: number;
    id: number | null;
    user_uid: string;
    area_id: number;
    name: string;
    latitude: string;
    longitude: string;
    photo: string;
    risk: 'low' | 'medium' | 'high';
    synced: number;
    created_at: string;
    user_name: string | null;
    user_username: string | null;
    user_phone: string | null;
    user_email: string | null;
    user_level: string | null;
    area_name: string | null;
    area_longitude: string | null;
    area_latitude: string | null;
  }>(`SELECT * FROM dangerous_areas ORDER BY created_at DESC`);

  return records.map((record) => ({
    local_id: record.local_id,
    id: record.id ?? undefined,
    user_uid: record.user_uid,
    area_id: record.area_id,
    name: record.name,
    latitude: record.latitude,
    longitude: record.longitude,
    photo: record.photo,
    risk: record.risk,
    synced: record.synced === 1,
    created_at: record.created_at,
    user: record.user_name
      ? {
          uid: record.user_uid,
          name: record.user_name,
          username: record.user_username ?? '',
          phone: record.user_phone ?? '',
          email: record.user_email ?? '',
          level: record.user_level ?? '',
        }
      : undefined,
    area: record.area_name
      ? {
          id: record.area_id,
          name: record.area_name,
          longtitude: record.area_longitude ?? '',
          latitude: record.area_latitude ?? '',
        }
      : undefined,
  }));
}

// Get unsynced dangerous areas
export function getUnsyncedDangerousAreas(): DangerousArea[] {
  const database = openDatabaseSync();
  initDangerousAreasTable();

  const records = database.getAllSync<{
    local_id: number;
    id: number | null;
    user_uid: string;
    area_id: number;
    name: string;
    latitude: string;
    longitude: string;
    photo: string;
    risk: 'low' | 'medium' | 'high';
    synced: number;
    created_at: string;
    user_name: string | null;
    user_username: string | null;
    user_phone: string | null;
    user_email: string | null;
    user_level: string | null;
  }>(`SELECT * FROM dangerous_areas WHERE synced = 0 ORDER BY created_at ASC`);

  return records.map((record) => ({
    local_id: record.local_id,
    id: record.id ?? undefined,
    user_uid: record.user_uid,
    area_id: record.area_id,
    name: record.name,
    latitude: record.latitude,
    longitude: record.longitude,
    photo: record.photo,
    risk: record.risk,
    synced: false,
    created_at: record.created_at,
    user: record.user_name
      ? {
          uid: record.user_uid,
          name: record.user_name,
          username: record.user_username ?? '',
          phone: record.user_phone ?? '',
          email: record.user_email ?? '',
          level: record.user_level ?? '',
        }
      : undefined,
  }));
}

// Get unsynced dangerous areas count
export function getUnsyncedDangerousAreasCount(): number {
  const database = openDatabaseSync();
  initDangerousAreasTable();

  const result = database.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM dangerous_areas WHERE synced = 0`
  );
  return result?.count ?? 0;
}

// Mark a dangerous area as synced
export function markDangerousAreaAsSynced(localId: number, serverId?: number): void {
  const database = openDatabaseSync();
  if (serverId) {
    database.runSync(`UPDATE dangerous_areas SET synced = 1, id = ? WHERE local_id = ?`, [
      serverId,
      localId,
    ]);
  } else {
    database.runSync(`UPDATE dangerous_areas SET synced = 1 WHERE local_id = ?`, [localId]);
  }
}

// Delete a local dangerous area by local_id
export function deleteLocalDangerousArea(localId: number): void {
  const database = openDatabaseSync();
  database.runSync(`DELETE FROM dangerous_areas WHERE local_id = ?`, [localId]);
}

// Clear all dangerous areas
export function clearAllDangerousAreas(): void {
  const database = openDatabaseSync();
  database.runSync(`DELETE FROM dangerous_areas`);
}

// ==========================================
// Map Images types and functions
// ==========================================

export interface MapImage {
  id: number;
  name: string;
  description: string | null;
  image_url: string;
  image_path: string;
  local_image_path: string | null;
  bottom_left_latitude: string;
  bottom_left_longitude: string;
  top_right_latitude: string;
  top_right_longitude: string;
  display_order: number;
  downloaded: boolean;
  created_at: string;
  updated_at: string;
}

// Initialize map images table
export function initMapImagesTable(): void {
  const database = openDatabaseSync();
  database.execSync(`
    CREATE TABLE IF NOT EXISTS map_images (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT NOT NULL,
      image_path TEXT NOT NULL,
      local_image_path TEXT,
      bottom_left_latitude TEXT NOT NULL,
      bottom_left_longitude TEXT NOT NULL,
      top_right_latitude TEXT NOT NULL,
      top_right_longitude TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      downloaded INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// Save or update a map image record
export function saveMapImage(mapImage: Omit<MapImage, 'downloaded' | 'local_image_path'>): void {
  const database = openDatabaseSync();
  initMapImagesTable();

  // Check if map already exists
  const existing = database.getFirstSync<{
    id: number;
    local_image_path: string | null;
    downloaded: number;
  }>(`SELECT id, local_image_path, downloaded FROM map_images WHERE id = ?`, [mapImage.id]);

  if (existing) {
    // Update existing record, preserve local_image_path and downloaded status
    database.runSync(
      `UPDATE map_images SET 
        name = ?, description = ?, image_url = ?, image_path = ?,
        bottom_left_latitude = ?, bottom_left_longitude = ?,
        top_right_latitude = ?, top_right_longitude = ?,
        display_order = ?, updated_at = ?
       WHERE id = ?`,
      [
        mapImage.name,
        mapImage.description,
        mapImage.image_url,
        mapImage.image_path,
        mapImage.bottom_left_latitude,
        mapImage.bottom_left_longitude,
        mapImage.top_right_latitude,
        mapImage.top_right_longitude,
        mapImage.display_order,
        mapImage.updated_at,
        mapImage.id,
      ]
    );
  } else {
    // Insert new record
    database.runSync(
      `INSERT INTO map_images 
       (id, name, description, image_url, image_path, local_image_path,
        bottom_left_latitude, bottom_left_longitude, top_right_latitude, top_right_longitude,
        display_order, downloaded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        mapImage.id,
        mapImage.name,
        mapImage.description,
        mapImage.image_url,
        mapImage.image_path,
        mapImage.bottom_left_latitude,
        mapImage.bottom_left_longitude,
        mapImage.top_right_latitude,
        mapImage.top_right_longitude,
        mapImage.display_order,
        mapImage.created_at,
        mapImage.updated_at,
      ]
    );
  }
}

// Save multiple map images from server
export function saveMapImagesFromServer(
  mapImages: Array<Omit<MapImage, 'downloaded' | 'local_image_path'>>
): void {
  for (const mapImage of mapImages) {
    saveMapImage(mapImage);
  }
}

// Update local image path and mark as downloaded
export function updateMapImageLocalPath(mapId: number, localPath: string): void {
  const database = openDatabaseSync();
  database.runSync(`UPDATE map_images SET local_image_path = ?, downloaded = 1 WHERE id = ?`, [
    localPath,
    mapId,
  ]);
}

// Get all map images
export function getAllMapImages(): MapImage[] {
  const database = openDatabaseSync();
  initMapImagesTable();

  const records = database.getAllSync<{
    id: number;
    name: string;
    description: string | null;
    image_url: string;
    image_path: string;
    local_image_path: string | null;
    bottom_left_latitude: string;
    bottom_left_longitude: string;
    top_right_latitude: string;
    top_right_longitude: string;
    display_order: number;
    downloaded: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM map_images ORDER BY display_order ASC, name ASC`);

  return records.map((record) => ({
    ...record,
    downloaded: record.downloaded === 1,
  }));
}

// Get downloaded map images only
export function getDownloadedMapImages(): MapImage[] {
  const database = openDatabaseSync();
  initMapImagesTable();

  const records = database.getAllSync<{
    id: number;
    name: string;
    description: string | null;
    image_url: string;
    image_path: string;
    local_image_path: string | null;
    bottom_left_latitude: string;
    bottom_left_longitude: string;
    top_right_latitude: string;
    top_right_longitude: string;
    display_order: number;
    downloaded: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM map_images WHERE downloaded = 1 ORDER BY display_order ASC, name ASC`);

  return records.map((record) => ({
    ...record,
    downloaded: true,
  }));
}

// Get a single map image by ID
export function getMapImageById(mapId: number): MapImage | null {
  const database = openDatabaseSync();
  initMapImagesTable();

  const record = database.getFirstSync<{
    id: number;
    name: string;
    description: string | null;
    image_url: string;
    image_path: string;
    local_image_path: string | null;
    bottom_left_latitude: string;
    bottom_left_longitude: string;
    top_right_latitude: string;
    top_right_longitude: string;
    display_order: number;
    downloaded: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM map_images WHERE id = ?`, [mapId]);

  if (!record) return null;

  return {
    ...record,
    downloaded: record.downloaded === 1,
  };
}

// Delete a map image and its local file reference
export function deleteMapImage(mapId: number): void {
  const database = openDatabaseSync();
  database.runSync(`DELETE FROM map_images WHERE id = ?`, [mapId]);
}

// Mark map as not downloaded (when file is deleted)
export function markMapAsNotDownloaded(mapId: number): void {
  const database = openDatabaseSync();
  database.runSync(`UPDATE map_images SET local_image_path = NULL, downloaded = 0 WHERE id = ?`, [
    mapId,
  ]);
}
