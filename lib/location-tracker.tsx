import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { useAuth } from './auth-context';
import {
  openDatabaseSync,
  insertLocationRecordSync,
  insertLocationRecord,
  getCheckinStatusSync,
  saveCheckinStatusSync,
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
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  refreshCheckinStatus: () => Promise<void>;
}

const LocationTrackerContext = createContext<LocationTrackerContextType | undefined>(undefined);

const TRACKING_INTERVAL = 900000; // 15 Mins
// const TRACKING_INTERVAL = 30000; // 15 Mins

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

  if (!status) {
    // No status available (not authenticated or no data)
    return { canTrack: false, reason: 'not_authenticated' };
  }

  if (!status.check_in) {
    return { canTrack: false, reason: 'not_checked_in' };
  }

  if (status.check_out) {
    return { canTrack: false, reason: 'already_checked_out' };
  }

  return { canTrack: true, reason: 'active' };
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

        // Save each location to database using sync function
        for (const location of locations) {
          try {
            insertLocationRecordSync({
              user_uid: userUid,
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              recorded_at: new Date(location.timestamp).toISOString(),
              synced: false,
            });

            console.log('Background location recorded:', {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              time: new Date(location.timestamp).toISOString(),
            });
          } catch (insertErr) {
            console.error('Error inserting location record:', insertErr);
          }
        }

        // Update status reason to active
        await SecureStore.setItemAsync('tracking_status_reason', 'active');
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
  }, []);

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
        distanceInterval: 0, // Track based on time, not distance
        deferredUpdatesInterval: TRACKING_INTERVAL,
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
  useEffect(() => {
    if (isAuthenticated && user?.uid && !isTracking) {
      // Only start tracking for SATPAM users
      if (user?.level === 'SATPAM') {
        startTracking();
      } else {
        setStatusReason('not_satpam');
        SecureStore.setItemAsync('tracking_status_reason', 'not_satpam');
      }
    }
  }, [isAuthenticated, user?.uid, user?.level, isTracking, startTracking]);

  // Stop tracking when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      stopTracking();
      SecureStore.deleteItemAsync('user_uid');
      SecureStore.deleteItemAsync('tracking_status_reason');
    }
  }, [isAuthenticated, stopTracking]);

  return (
    <LocationTrackerContext.Provider
      value={{
        isTracking,
        lastLocation,
        error,
        statusReason,
        startTracking,
        stopTracking,
        refreshCheckinStatus,
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
