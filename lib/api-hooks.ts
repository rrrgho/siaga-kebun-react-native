import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from './api-client';
import {
  getUnsyncedLocationRecords,
  markRecordsAsSynced,
  LocationRecord,
  saveWorkAllocations,
  getWorkAllocations,
  WorkAllocation,
  saveCheckinStatus,
  getCheckinStatus,
  updateCheckinSync,
  updateCheckoutSync,
  DangerousArea,
  saveDangerousAreasFromServer,
  getAllDangerousAreas,
  getUnsyncedDangerousAreas,
  markDangerousAreaAsSynced,
  MapImage,
  saveMapImagesFromServer,
  getAllMapImages,
  getDownloadedMapImages,
  updateMapImageLocalPath,
} from './database';

interface CheckinPayload {
  checkin_time: string;
}

interface CheckoutPayload {
  checkout_time: string;
}

interface CheckinResponse {
  message: string;
  data: {
    user_uid: string;
    checkin_time: string;
    updated_at: string;
    created_at: string;
    id: number;
  };
}

interface TodayStatusResponse {
  check_in: boolean;
  check_out: boolean;
}

interface TrackingPayload {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

interface WorkAllocationResponse {
  data: WorkAllocation[];
}

export interface SatpamUserShift {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface SatpamUser {
  uid: string;
  name: string;
  shift: SatpamUserShift | null;
}

interface SatpamUsersResponse {
  success: boolean;
  message: string;
  data: SatpamUser[];
}

// Get today's checkin/checkout status (with offline support)
export function useTodayStatus(userUid?: string) {
  return useQuery({
    queryKey: ['todayStatus', userUid],
    queryFn: async () => {
      try {
        console.log('Using internet checkin status (ONLINE mode)');
        const response = await apiClient.get<TodayStatusResponse>('/checkin/today-status');
        const status = response.data;

        // Save to local database for offline access
        if (userUid) {
          await saveCheckinStatus(userUid, status);
        }

        return status;
      } catch (error) {
        // If offline, try to get from local database
        if (userUid) {
          const localStatus = await getCheckinStatus(userUid);
          if (localStatus) {
            console.log('Using local checkin status (offline mode)');
            return localStatus;
          }
        }
        throw error;
      }
    },
    enabled: !!userUid,
    refetchOnWindowFocus: true,
    staleTime: 1000 * 60, // 1 minute
  });
}

// Checkin mutation
export function useCheckin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (checkinTime: Date) => {
      const payload: CheckinPayload = {
        checkin_time: formatDateTime(checkinTime),
      };
      const response = await apiClient.post<CheckinResponse>('/checkin', payload);

      // Update local storage immediately for offline support
      const userUid = response.data.data.user_uid;
      updateCheckinSync(userUid, true);

      return response.data;
    },
    onSuccess: () => {
      // Invalidate today status to refresh the checkin/checkout state
      queryClient.invalidateQueries({ queryKey: ['todayStatus'] });
    },
  });
}

// Checkout mutation
export function useCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (checkoutTime: Date) => {
      const payload: CheckoutPayload = {
        checkout_time: formatDateTime(checkoutTime),
      };
      const response = await apiClient.post<CheckinResponse>('/checkout', payload);

      // Update local storage immediately for offline support
      const userUid = response.data.data.user_uid;
      updateCheckoutSync(userUid, true);

      return response.data;
    },
    onSuccess: () => {
      // Invalidate today status to refresh the checkin/checkout state
      queryClient.invalidateQueries({ queryKey: ['todayStatus'] });
    },
  });
}

// Sync location records mutation
export function useSyncLocations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userUid: string) => {
      // Get all unsynced records
      const unsyncedRecords = await getUnsyncedLocationRecords(userUid);

      if (unsyncedRecords.length === 0) {
        return { synced: 0, message: 'No records to sync' };
      }

      // Prepare payload
      const payload: TrackingPayload[] = unsyncedRecords.map((record) => ({
        latitude: record.latitude,
        longitude: record.longitude,
        recorded_at: record.recorded_at,
      }));

      // Send to API
      await apiClient.post('/tracking', payload);

      // Mark records as synced
      const ids = unsyncedRecords.map((r) => r.id).filter((id): id is number => id !== undefined);
      await markRecordsAsSynced(ids);

      return {
        synced: unsyncedRecords.length,
        message: `Synced ${unsyncedRecords.length} records`,
      };
    },
    onSuccess: () => {
      // Invalidate location records query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['locationRecords'] });
    },
  });
}

// Get today's work allocations
export function useTodayWorkAllocations(userUid?: string) {
  return useQuery({
    queryKey: ['todayWorkAllocations', userUid],
    queryFn: async () => {
      try {
        const response = await apiClient.get<WorkAllocationResponse>('/work-allocation/today');
        const allocations = response.data.data;

        // Save to local database for offline access
        if (userUid) {
          await saveWorkAllocations(userUid, allocations);
        }

        return allocations;
      } catch (error) {
        // If offline, try to get from local database
        if (userUid) {
          const localAllocations = await getWorkAllocations(userUid);
          if (localAllocations.length > 0) {
            return localAllocations;
          }
        }
        throw error;
      }
    },
    enabled: !!userUid,
    refetchOnWindowFocus: true,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry if we have offline data
      return failureCount < 2;
    },
  });
}

// Get list of satpam users (for managers)
export function useSatpamUsers(enabled: boolean = true) {
  return useQuery({
    queryKey: ['satpamUsers'],
    queryFn: async () => {
      const response = await apiClient.get<SatpamUsersResponse>('/users/satpam');
      return response.data.data;
    },
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Helper function to format datetime for API
function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Dangerous Areas API types
interface DangerousAreaApiResponse {
  id: number;
  user_uid: string;
  area_id: number;
  longtitude: string; // Note: API uses "longtitude" (typo)
  latitude: string;
  name: string;
  photo: string;
  risk: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  area: {
    id: number;
    name: string;
    longtitude: string;
    latitude: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
  user: {
    uid: string;
    name: string;
    username: string;
    phone: string;
    email: string;
    level: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  };
}

interface DangerousAreasListResponse {
  data: DangerousAreaApiResponse[];
}

interface CreateDangerousAreaResponse {
  message: string;
  data: DangerousAreaApiResponse;
}

// Fetch dangerous areas from server and save to local DB
export function useFetchDangerousAreas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.get<DangerousAreasListResponse>('/dangerous-areas');
      const areas = response.data.data;

      // Transform API response to local format and save to SQLite
      const transformedAreas: DangerousArea[] = areas.map((area) => ({
        id: area.id,
        user_uid: area.user_uid,
        area_id: area.area_id,
        name: area.name || 'Unnamed Area',
        latitude: area.latitude,
        longitude: area.longtitude, // Note: API uses "longtitude"
        photo: area.photo,
        risk: area.risk,
        synced: true,
        created_at: area.created_at,
        user: area.user
          ? {
              uid: area.user.uid,
              name: area.user.name,
              username: area.user.username,
              phone: area.user.phone,
              email: area.user.email,
              level: area.user.level,
            }
          : undefined,
        area: area.area
          ? {
              id: area.area.id,
              name: area.area.name,
              longtitude: area.area.longtitude,
              latitude: area.area.latitude,
            }
          : undefined,
      }));

      saveDangerousAreasFromServer(transformedAreas);

      return {
        count: areas.length,
        message: `Downloaded ${areas.length} dangerous areas`,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dangerousAreas'] });
    },
  });
}

// Get dangerous areas from local database
export function useLocalDangerousAreas() {
  return useQuery({
    queryKey: ['dangerousAreas'],
    queryFn: async () => {
      return getAllDangerousAreas();
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

// Upload a single dangerous area to server
export function useUploadDangerousArea() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (area: DangerousArea) => {
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('name', area.name);
      formData.append('latitude', area.latitude);
      formData.append('longitude', area.longitude);
      formData.append('risk', area.risk);
      formData.append('area_id', String(area.area_id));

      // Handle photo - if it's a local file path, we need to create a file blob
      if (area.photo && !area.photo.startsWith('http')) {
        const photoUri = area.photo;
        const filename = photoUri.split('/').pop() || 'photo.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';

        formData.append('photo', {
          uri: photoUri,
          name: filename,
          type,
        } as any);
      }

      console.log('FORM: ', formData);

      const response = await apiClient.post<CreateDangerousAreaResponse>(
        '/dangerous-areas',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      // Mark as synced in local DB
      if (area.local_id) {
        markDangerousAreaAsSynced(area.local_id, response.data.data.id);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dangerousAreas'] });
    },
  });
}

// Upload all unsynced dangerous areas
export function useUploadAllDangerousAreas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const unsyncedAreas = getUnsyncedDangerousAreas();

      if (unsyncedAreas.length === 0) {
        return { uploaded: 0, message: 'No areas to upload' };
      }

      let successCount = 0;
      const errors: string[] = [];

      // Upload one by one (API doesn't support batch)
      for (const area of unsyncedAreas) {
        try {
          const formData = new FormData();
          formData.append('name', area.name);
          formData.append('latitude', area.latitude);
          formData.append('longitude', area.longitude);
          formData.append('risk', area.risk);
          formData.append('area_id', String(area.area_id));

          // Handle photo
          if (area.photo && !area.photo.startsWith('http')) {
            const photoUri = area.photo;
            const filename = photoUri.split('/').pop() || 'photo.jpg';
            const match = /\.(\w+)$/.exec(filename);
            const type = match ? `image/${match[1]}` : 'image/jpeg';

            formData.append('photo', {
              uri: photoUri,
              name: filename,
              type,
            } as any);
          }

          console.log('FORM: ', formData);

          const response = await apiClient.post<CreateDangerousAreaResponse>(
            '/dangerous-areas',
            formData,
            {
              headers: {
                'Content-Type': 'multipart/form-data',
              },
            }
          );

          // Mark as synced
          if (area.local_id) {
            markDangerousAreaAsSynced(area.local_id, response.data.data.id);
          }

          successCount++;
        } catch (error: any) {
          console.error('Failed to upload dangerous area:', error);
          errors.push(area.name || 'Unknown area');
        }
      }

      return {
        uploaded: successCount,
        failed: errors.length,
        errors,
        message:
          errors.length > 0
            ? `Uploaded ${successCount} areas, ${errors.length} failed`
            : `Successfully uploaded ${successCount} areas`,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dangerousAreas'] });
    },
  });
}

// Panic Button Types
interface PanicButtonPayload {
  latitude: number;
  longitude: number;
  notes: string;
}

interface PanicButtonResponse {
  success: boolean;
  message: string;
  data: {
    id: number;
    user: {
      uid: string;
      name: string;
    };
    latitude: number;
    longitude: number;
    notes: string;
    status: string;
    created_at: string;
  };
}

// Panic Button mutation
export function usePanicButton() {
  return useMutation({
    mutationFn: async (payload: PanicButtonPayload) => {
      const response = await apiClient.post<PanicButtonResponse>('/panic-buttons', payload);
      return response.data;
    },
  });
}

// ==========================================
// Map Images API
// ==========================================

interface MapImageAPIResponse {
  id: number;
  name: string;
  description: string | null;
  image_url: string;
  image_path: string;
  bounding_box: [[string, string], [string, string]];
  bottom_left_latitude: string;
  bottom_left_longitude: string;
  top_right_latitude: string;
  top_right_longitude: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface MapImagesResponse {
  success: boolean;
  data: MapImageAPIResponse[];
  count: number;
}

// Fetch active map images from API and save to local database
export function useActiveMapImages() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['activeMapImages'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<MapImagesResponse>('/map-images/active');
        const mapImages = response.data.data;

        // Transform and save to local database
        const transformedMaps = mapImages.map((map) => ({
          id: map.id,
          name: map.name,
          description: map.description,
          image_url: map.image_url,
          image_path: map.image_path,
          bottom_left_latitude: map.bottom_left_latitude,
          bottom_left_longitude: map.bottom_left_longitude,
          top_right_latitude: map.top_right_latitude,
          top_right_longitude: map.top_right_longitude,
          display_order: map.display_order,
          created_at: map.created_at,
          updated_at: map.updated_at,
        }));

        saveMapImagesFromServer(transformedMaps);

        // Return all maps from local database (includes download status)
        return getAllMapImages();
      } catch (error) {
        // If offline, try to get from local database
        const localMaps = getAllMapImages();
        if (localMaps.length > 0) {
          console.log('Using local map images (offline mode)');
          return localMaps;
        }
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Get locally stored map images (for offline use)
export function useLocalMapImages() {
  return useQuery({
    queryKey: ['localMapImages'],
    queryFn: async () => {
      return getAllMapImages();
    },
  });
}

// Get downloaded map images only
export function useDownloadedMapImages() {
  return useQuery({
    queryKey: ['downloadedMapImages'],
    queryFn: async () => {
      return getDownloadedMapImages();
    },
  });
}
