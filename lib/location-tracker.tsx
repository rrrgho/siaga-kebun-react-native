import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { useAuth } from './auth-context';
import {
  openDatabaseSync,
  insertLocationRecordSync,
  insertLocationRecord,
  getCheckinStatusSync,
  saveCheckinStatusSync,
  getUnsyncedCountSync,
  getUnsyncedLocationRecordsSync,
  markRecordsAsSyncedSync,
  deleteSyncedRecordsSync,
  incrementSyncedCountSync,
} from './database';
import { apiClient } from './api-client';

// Background task name
const BACKGROUND_LOCATION_TASK = 'background-location-task';

// Tracking status reasons
export type TrackingStatusReason =
  | 'active' // Currently tracking
  | 'not_checked_in' // User hasn't checked in yet
  | 'already_checked_out' // User has already checked out
  | 'not_authenticated' // User is not logged in
  | 'not_satpam' // User is not a security officer
  | 'permission_denied' // Location permission denied
  | 'stopped'; // Tracking manually stopped

// Helper function to get human-readable status messages
export function getTrackingStatusMessage(reason: TrackingStatusReason): {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
} {
  switch (reason) {
    case 'active':
      return {
        title: 'Tracking Active',
        message: 'Your location is being recorded.',
        type: 'success',
      };
    case 'not_checked_in':
      return {
        title: 'Not Checked In',
        message: 'Location is not recorded. Please check in to start tracking.',
        type: 'warning',
      };
    case 'already_checked_out':
      return {
        title: 'Already Checked Out',
        message:
          'Location is not recorded. You have already checked out for today. If you think you have not checked in or checked out, please Relogin to refresh status, and make sure you have internet connection',
        type: 'info',
      };
    case 'not_authenticated':
      return {
        title: 'Not Logged In',
        message: 'Please log in to enable location tracking.',
        type: 'error',
      };
    case 'not_satpam':
      return {
        title: 'Manager Account',
        message: 'Location tracking is only for security officers.',
        type: 'info',
      };
    case 'permission_denied':
      return {
        title: 'Permission Denied',
        message: 'Location permission is required. Please enable it in settings.',
        type: 'error',
      };
    case 'stopped':
      return {
        title: 'Tracking Stopped',
        message: 'Location tracking is currently stopped.',
        type: 'info',
      };
    default:
      return {
        title: 'Unknown Status',
        message: 'Unable to determine tracking status.',
        type: 'info',
      };
  }
}

interface LocationTrackerContextType {
  isTracking: boolean;
  lastLocation: Location.LocationObject | null;
  error: string | null;
  statusReason: TrackingStatusReason;
  lastSyncTime: Date | null;
  isSyncing: boolean;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  refreshCheckinStatus: () => Promise<void>;
  refreshLastSyncTime: () => Promise<void>;
  syncNow: () => Promise<{ synced: number; sent: number; deleted: number } | null>;
}

const LocationTrackerContext = createContext<LocationTrackerContextType | undefined>(undefined);

// const TRACKING_INTERVAL = 900000; // 15 Mins
const TRACKING_INTERVAL = 300000; // 5 Mins
const AUTO_SYNC_INTERVAL = 300000; // 5 Mins - Auto sync interval
const MIN_SYNC_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes - minimum interval between synced records

// Helper function to fetch today's checkin status from API and save to local storage
async function fetchAndSaveTodayStatus(
  userUid: string
): Promise<{ check_in: boolean; check_out: boolean } | null> {
  try {
    const token = await SecureStore.getItemAsync('auth_token');
    if (!token) return null;

    const response = await apiClient.get<{ check_in: boolean; check_out: boolean }>(
      '/checkin/today-status'
    );
    const status = response.data;

    // Save to local database for offline use
    saveCheckinStatusSync(userUid, status);

    return status;
  } catch (error) {
    console.error('Error fetching today status from API:', error);
    return null;
  }
}

// Helper to check if tracking should be active based on checkin status
// Uses local storage first, falls back to API if needed
async function shouldTrackLocation(): Promise<{ canTrack: boolean; reason: TrackingStatusReason }> {
  const userUid = await SecureStore.getItemAsync('user_uid');

  if (!userUid) {
    return { canTrack: false, reason: 'not_authenticated' };
  }

  // First, try to get status from local database (works offline)
  let status = getCheckinStatusSync(userUid);

  // If no local status, try to fetch from API (only when online)
  if (!status) {
    console.log('No local checkin status found, trying API...');
    status = await fetchAndSaveTodayStatus(userUid);
  }

  // OFFLINE MODE: If still no status, assume user can track
  // This allows location recording to continue when offline
  // The background task will save locations locally, and they'll sync later
  if (!status) {
    console.log('No checkin status available (offline), allowing tracking to continue');
    return { canTrack: true, reason: 'active' };
  }

  if (!status.check_in) {
    return { canTrack: false, reason: 'not_checked_in' };
  }

  if (status.check_out) {
    return { canTrack: false, reason: 'already_checked_out' };
  }

  return { canTrack: true, reason: 'active' };
}

// Get last synced record time from storage (sync version for background task)
function getLastSyncedRecordTimeSync(): Date | null {
  try {
    // Use a simple in-memory cache since SecureStore is async
    // This will be updated after each sync
    return lastSyncedRecordTimeCache;
  } catch {
    return null;
  }
}

// In-memory cache for last synced record time
let lastSyncedRecordTimeCache: Date | null = null;

// Initialize cache from SecureStore (called at startup)
async function initLastSyncedRecordTime(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync('last_synced_record_time');
    if (stored) {
      lastSyncedRecordTimeCache = new Date(stored);
    }
  } catch (err) {
    console.error('Error loading last synced record time:', err);
  }
}

// Update last synced record time
async function setLastSyncedRecordTime(time: Date): Promise<void> {
  lastSyncedRecordTimeCache = time;
  await SecureStore.setItemAsync('last_synced_record_time', time.toISOString());
}

// Filter records to only include those with at least MIN_SYNC_INTERVAL_MS difference
// from the last successfully synced record
function filterRecordsByIntervalSync(
  records: { id?: number; latitude: number; longitude: number; recorded_at: string }[]
): { records: typeof records; lastTime: Date | null } {
  if (records.length === 0) return { records: [], lastTime: null };

  const filteredRecords: typeof records = [];
  // Start from the last synced record time, or null if no previous sync
  let lastSyncedTime: Date | null = getLastSyncedRecordTimeSync();

  for (const record of records) {
    const recordTime = new Date(record.recorded_at);

    if (lastSyncedTime === null) {
      // No previous sync, send this record
      filteredRecords.push(record);
      lastSyncedTime = recordTime;
    } else {
      const timeDiff = recordTime.getTime() - lastSyncedTime.getTime();
      if (timeDiff >= MIN_SYNC_INTERVAL_MS) {
        filteredRecords.push(record);
        lastSyncedTime = recordTime;
      }
    }
  }

  return { records: filteredRecords, lastTime: lastSyncedTime };
}

// Sync function that can run in background
async function syncLocationsToServer(
  userUid: string
): Promise<{ synced: number; sent: number; deleted: number }> {
  const unsyncedRecords = getUnsyncedLocationRecordsSync(userUid);

  if (unsyncedRecords.length === 0) {
    return { synced: 0, sent: 0, deleted: 0 };
  }

  // Filter records to only send those with at least 20 minutes interval
  // from the last successfully synced record
  const { records: recordsToSend, lastTime } = filterRecordsByIntervalSync(unsyncedRecords);

  // Only send to API if there are records to send
  if (recordsToSend.length > 0) {
    const payload = recordsToSend.map((record) => ({
      latitude: record.latitude,
      longitude: record.longitude,
      recorded_at: record.recorded_at,
    }));

    await apiClient.post('/tracking', payload);

    // Update last synced record time after successful API call
    if (lastTime) {
      await setLastSyncedRecordTime(lastTime);
    }

    // Increment total synced count (for UI display)
    incrementSyncedCountSync(userUid, recordsToSend.length);
  }

  // Mark ALL unsynced records as synced
  const allIds = unsyncedRecords.map((r) => r.id).filter((id): id is number => id !== undefined);
  markRecordsAsSyncedSync(allIds);

  // Delete all synced records to optimize storage
  const deletedCount = deleteSyncedRecordsSync(userUid);

  console.log(
    `Sync complete: processed ${unsyncedRecords.length}, sent ${recordsToSend.length}, deleted ${deletedCount}`
  );

  return {
    synced: unsyncedRecords.length,
    sent: recordsToSend.length,
    deleted: deletedCount,
  };
}

// Background sync function - runs in background task
async function performBackgroundSync(userUid: string): Promise<void> {
  try {
    // Check internet connection
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      console.log('Background sync: No internet connection, skipping');
      return;
    }

    // Check if there are records to sync
    const unsyncedCount = getUnsyncedCountSync(userUid);
    if (unsyncedCount === 0) {
      console.log('Background sync: No unsynced records');
      return;
    }

    // Initialize last synced record time cache before syncing
    await initLastSyncedRecordTime();

    console.log(`Background sync: Starting sync of ${unsyncedCount} records...`);
    const result = await syncLocationsToServer(userUid);

    // Store last sync time
    await SecureStore.setItemAsync('last_sync_time', new Date().toISOString());
    console.log(`Background sync complete: sent ${result.sent}, deleted ${result.deleted}`);
  } catch (err) {
    console.error('Background sync error:', err);
    // Don't throw - background sync should be silent
  }
}

// Define the background task outside of React component
// This task runs even when the app is closed
TaskManager.defineTask(
  BACKGROUND_LOCATION_TASK,
  async ({
    data,
    error,
  }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
    if (error) {
      console.error('Background location task error:', error);
      return;
    }

    if (data) {
      const { locations } = data;

      try {
        // Get stored user UID first
        const userUid = await SecureStore.getItemAsync('user_uid');

        if (!userUid) {
          console.log('No user UID found, skipping background location save');
          return;
        }

        // Check if user should be tracking (checked in and not checked out)
        const { canTrack, reason } = await shouldTrackLocation();

        if (!canTrack) {
          console.log(`Background location not recorded: ${reason}`);
          // Store the reason so the app can display it when opened
          await SecureStore.setItemAsync('tracking_status_reason', reason);
          return;
        }

        // Initialize database with sync API for background compatibility
        openDatabaseSync();

        // Save only the latest location (not all accumulated locations)
        const latestLocation = locations[locations.length - 1];
        try {
          insertLocationRecordSync({
            user_uid: userUid,
            latitude: latestLocation.coords.latitude,
            longitude: latestLocation.coords.longitude,
            recorded_at: new Date(latestLocation.timestamp).toISOString(),
            synced: false,
          });

          console.log('Background location recorded:', {
            lat: latestLocation.coords.latitude,
            lng: latestLocation.coords.longitude,
            time: new Date(latestLocation.timestamp).toISOString(),
          });
        } catch (insertErr) {
          console.error('Error inserting location record:', insertErr);
        }

        // Update status reason to active
        await SecureStore.setItemAsync('tracking_status_reason', 'active');

        // Perform background sync after saving location
        // This runs every time location is recorded (every 5 minutes)
        await performBackgroundSync(userUid);
      } catch (err) {
        console.error('Error saving background location:', err);
      }
    }
  }
);

export function LocationTrackerProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [isTracking, setIsTracking] = useState(false);
  const [lastLocation, setLastLocation] = useState<Location.LocationObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState<TrackingStatusReason>('stopped');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Track if we've already attempted to start tracking this session
  const hasAttemptedStart = useRef(false);
  const autoSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Check if background tracking is already running
  const checkTrackingStatus = useCallback(async () => {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK
    ).catch(() => false);
    setIsTracking(hasStarted);

    // Load stored status reason
    const storedReason = await SecureStore.getItemAsync('tracking_status_reason');
    if (storedReason) {
      setStatusReason(storedReason as TrackingStatusReason);
    }

    // Load last sync time from storage
    const storedSyncTime = await SecureStore.getItemAsync('last_sync_time');
    if (storedSyncTime) {
      setLastSyncTime(new Date(storedSyncTime));
    }

    // Initialize last synced record time cache for 20-minute filtering
    await initLastSyncedRecordTime();

    return hasStarted;
  }, []);

  // Refresh last sync time from storage (for when background sync updates it)
  const refreshLastSyncTime = useCallback(async () => {
    const storedSyncTime = await SecureStore.getItemAsync('last_sync_time');
    if (storedSyncTime) {
      setLastSyncTime(new Date(storedSyncTime));
    }
  }, []);

  // Manual sync function exposed to UI
  const syncNow = useCallback(async (): Promise<{
    synced: number;
    sent: number;
    deleted: number;
  } | null> => {
    if (!user?.uid || isSyncing) return null;

    try {
      setIsSyncing(true);

      // Check internet connection
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        console.log('No internet connection, skipping sync');
        return null;
      }

      const result = await syncLocationsToServer(user.uid);
      const syncTime = new Date();
      setLastSyncTime(syncTime);
      await SecureStore.setItemAsync('last_sync_time', syncTime.toISOString());
      return result;
    } catch (err) {
      console.error('Error syncing locations:', err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [user?.uid, isSyncing]);

  // Auto-sync function (silent, no errors thrown) - for foreground sync
  const performAutoSync = useCallback(async () => {
    if (!user?.uid || isSyncing) return;

    try {
      // Check internet connection
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        console.log('Auto-sync: No internet connection, skipping');
        return;
      }

      // Check if there are records to sync
      const unsyncedCount = getUnsyncedCountSync(user.uid);
      if (unsyncedCount === 0) {
        console.log('Auto-sync: No unsynced records');
        return;
      }

      console.log(`Auto-sync: Starting sync of ${unsyncedCount} records...`);
      setIsSyncing(true);

      const result = await syncLocationsToServer(user.uid);
      const syncTime = new Date();
      setLastSyncTime(syncTime);
      await SecureStore.setItemAsync('last_sync_time', syncTime.toISOString());
      console.log(`Auto-sync complete: sent ${result.sent}, deleted ${result.deleted}`);
    } catch (err) {
      console.error('Auto-sync error:', err);
      // Don't throw - auto-sync should be silent
    } finally {
      setIsSyncing(false);
    }
  }, [user?.uid, isSyncing]);

  // Set up auto-sync interval
  useEffect(() => {
    if (!isAuthenticated || !user?.uid) {
      // Clear interval if not authenticated
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
      return;
    }

    // Only for SATPAM users
    if (user?.level !== 'SATPAM') {
      return;
    }

    // Perform initial sync after a short delay
    const initialSyncTimeout = setTimeout(() => {
      performAutoSync();
    }, 10000); // 10 seconds after mount

    // Set up interval for auto-sync every 5 minutes
    autoSyncIntervalRef.current = setInterval(() => {
      performAutoSync();
    }, AUTO_SYNC_INTERVAL);

    return () => {
      clearTimeout(initialSyncTimeout);
      if (autoSyncIntervalRef.current) {
        clearInterval(autoSyncIntervalRef.current);
        autoSyncIntervalRef.current = null;
      }
    };
  }, [isAuthenticated, user?.uid, user?.level, performAutoSync]);

  // Handle app state changes - sync when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        user?.level === 'SATPAM'
      ) {
        console.log('App came to foreground, refreshing sync status and triggering auto-sync');
        // Refresh last sync time from storage (may have been updated by background sync)
        refreshLastSyncTime();
        performAutoSync();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [performAutoSync, refreshLastSyncTime, user?.level]);

  // Refresh checkin status and update tracking state
  const refreshCheckinStatus = useCallback(async () => {
    const { canTrack, reason } = await shouldTrackLocation();
    setStatusReason(reason);
    await SecureStore.setItemAsync('tracking_status_reason', reason);

    // If can't track and currently tracking, we keep the background task running
    // but locations won't be saved (the background task checks status before saving)
    // If can track and not currently tracking, start tracking
    if (canTrack && !isTracking && isAuthenticated && user?.uid) {
      // Start tracking if conditions are met
    }
  }, [isTracking, isAuthenticated, user?.uid]);

  // Store user UID for background task access
  useEffect(() => {
    if (user?.uid) {
      SecureStore.setItemAsync('user_uid', user.uid);
    }
  }, [user?.uid]);

  const startTracking = useCallback(async () => {
    try {
      // Check checkin status first
      const { canTrack, reason } = await shouldTrackLocation();
      setStatusReason(reason);
      await SecureStore.setItemAsync('tracking_status_reason', reason);

      if (!canTrack) {
        // Still start the background task, but it won't save locations
        // This way, when user checks in, locations will start being recorded
        console.log(`Tracking condition not met: ${reason}`);
      }

      // Request foreground permission first
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        setError('Foreground location permission denied');
        setStatusReason('permission_denied');
        return;
      }

      // Request background permission
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        setError('Background location permission denied. Please enable it in settings.');
        // Still continue with foreground-only tracking
      }

      // Initialize database with sync API
      openDatabaseSync();

      // Check if task is already running
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      ).catch(() => false);

      if (hasStarted) {
        console.log('Background location tracking already running');
        setIsTracking(true);
        return;
      }

      // Get initial location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLastLocation(location);

      // Save initial location only if tracking conditions are met
      if (user?.uid && canTrack) {
        insertLocationRecordSync({
          user_uid: user.uid,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          recorded_at: new Date(location.timestamp).toISOString(),
          synced: false,
        });

        console.log('Initial location recorded:', {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          time: new Date(location.timestamp).toISOString(),
        });
      }

      // Start background location updates
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: TRACKING_INTERVAL,
        distanceInterval: 0, // Track based on time only
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Siaga Kebun',
          notificationBody: 'Location tracking is active',
          notificationColor: '#7bed9a',
        },
        // Android specific
        ...(Platform.OS === 'android' && {
          foregroundService: {
            notificationTitle: 'Siaga Kebun',
            notificationBody: 'Tracking your location for security monitoring',
            notificationColor: '#7bed9a',
          },
        }),
        // iOS specific
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.Other,
      });

      setIsTracking(true);
      setError(null);
      console.log('Background location tracking started');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start tracking';
      setError(errorMessage);
      console.error('Error starting location tracking:', err);
    }
  }, [user?.uid]);

  const stopTracking = useCallback(async () => {
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      ).catch(() => false);

      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        console.log('Background location tracking stopped');
      }

      setIsTracking(false);
      setStatusReason('stopped');
      await SecureStore.setItemAsync('tracking_status_reason', 'stopped');
    } catch (err) {
      console.error('Error stopping location tracking:', err);
    }
  }, []);

  // Check tracking status on mount
  useEffect(() => {
    checkTrackingStatus();
  }, [checkTrackingStatus]);

  // Auto-start tracking when authenticated (only for SATPAM)
  // This effect only runs once per session to avoid repeated starts on reload
  useEffect(() => {
    const initTracking = async () => {
      // Skip if we've already attempted to start this session
      if (hasAttemptedStart.current) {
        return;
      }

      if (!isAuthenticated || !user?.uid) {
        return;
      }

      // Check if tracking is already running in background
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      ).catch(() => false);

      if (alreadyRunning) {
        console.log('Background tracking already running, skipping start');
        setIsTracking(true);
        // Refresh the status reason
        const { reason } = await shouldTrackLocation();
        setStatusReason(reason);
        return;
      }

      // Mark that we've attempted to start
      hasAttemptedStart.current = true;

      // Only start tracking for SATPAM users
      if (user?.level === 'SATPAM') {
        console.log('Starting tracking for SATPAM user');
        startTracking();
      } else {
        setStatusReason('not_satpam');
        SecureStore.setItemAsync('tracking_status_reason', 'not_satpam');
      }
    };

    initTracking();
  }, [isAuthenticated, user?.uid, user?.level, startTracking]);

  // Stop tracking when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      stopTracking();
      SecureStore.deleteItemAsync('user_uid');
      SecureStore.deleteItemAsync('tracking_status_reason');
      // Reset the start attempt flag so tracking can start again on next login
      hasAttemptedStart.current = false;
    }
  }, [isAuthenticated, stopTracking]);

  return (
    <LocationTrackerContext.Provider
      value={{
        isTracking,
        lastLocation,
        error,
        statusReason,
        lastSyncTime,
        isSyncing,
        startTracking,
        stopTracking,
        refreshCheckinStatus,
        refreshLastSyncTime,
        syncNow,
      }}>
      {children}
    </LocationTrackerContext.Provider>
  );
}

export function useLocationTracker() {
  const context = useContext(LocationTrackerContext);
  if (context === undefined) {
    throw new Error('useLocationTracker must be used within a LocationTrackerProvider');
  }
  return context;
}
