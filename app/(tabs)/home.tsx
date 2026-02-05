import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  SatpamUser,
  useCheckin,
  useCheckout,
  usePanicButton,
  useSatpamUsers,
  useTodayStatus,
  useTodayWorkAllocations,
} from '@/lib/api-hooks';
import { WEB_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { getUnsyncedCount, getSyncedCount, WorkAllocation } from '@/lib/database';
import { getTrackingStatusMessage, useLocationTracker } from '@/lib/location-tracker';
import { cn } from '@/lib/utils';
import * as WebBrowser from 'expo-web-browser';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudUploadIcon,
  InfoIcon,
  LogInIcon,
  LogOutIcon,
  MapPinIcon,
  RefreshCwIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

const EMERGENCY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

export default function HomeScreen() {
  // ============================================
  // ALL HOOKS MUST BE DECLARED AT THE TOP
  // in the same order on every render
  // ============================================

  // Context hooks
  const { user, logout } = useAuth();
  const {
    isTracking,
    lastLocation,
    error: trackingError,
    statusReason,
    lastSyncTime,
    isSyncing,
    refreshCheckinStatus,
    refreshLastSyncTime,
    syncNow,
  } = useLocationTracker();

  // Mutation hooks
  const checkinMutation = useCheckin();
  const checkoutMutation = useCheckout();
  const panicButtonMutation = usePanicButton();

  // State hooks - ALL useState must be together
  const [lastEmergencyTime, setLastEmergencyTime] = React.useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = React.useState<number>(0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [unsyncedCount, setUnsyncedCount] = React.useState(0);
  const [syncedCount, setSyncedCount] = React.useState(0);

  // Ref hooks
  const bounceAnim = React.useRef(new Animated.Value(1)).current;

  // Derived values (NOT hooks) - safe to compute after hooks
  const isSatpam = user?.level === 'SATPAM';

  // Query hooks - ALWAYS called, use enabled flag to control fetching
  const {
    data: todayStatus,
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
  } = useTodayStatus(isSatpam ? user?.uid : undefined);

  const {
    data: workAllocations,
    isLoading: isLoadingAllocations,
    refetch: refetchAllocations,
  } = useTodayWorkAllocations(isSatpam ? user?.uid : undefined);

  const {
    data: satpamUsers,
    isLoading: isLoadingSatpamUsers,
    refetch: refetchSatpamUsers,
  } = useSatpamUsers(!isSatpam);

  // Derived states for checkin/checkout
  const hasCheckedIn = todayStatus?.check_in ?? false;
  const hasCheckedOut = todayStatus?.check_out ?? false;

  // Emergency button cooldown check
  const isEmergencyCooldown = cooldownRemaining > 0;

  // Get tracking status message
  const trackingStatusInfo = getTrackingStatusMessage(statusReason);

  // Bounce animation for emergency button
  React.useEffect(() => {
    if (!isEmergencyCooldown && !panicButtonMutation.isPending) {
      const bounceAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: 1.1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      bounceAnimation.start();
      return () => bounceAnimation.stop();
    } else {
      bounceAnim.setValue(1);
    }
  }, [isEmergencyCooldown, panicButtonMutation.isPending, bounceAnim]);

  // Cooldown timer effect
  React.useEffect(() => {
    if (lastEmergencyTime === null) return;

    const updateCooldown = () => {
      const elapsed = Date.now() - lastEmergencyTime;
      const remaining = Math.max(0, EMERGENCY_COOLDOWN_MS - elapsed);
      setCooldownRemaining(remaining);
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);

    return () => clearInterval(interval);
  }, [lastEmergencyTime]);

  // Load unsynced and synced counts
  const loadLocationCounts = React.useCallback(async () => {
    if (!user?.uid || !isSatpam) return;
    try {
      const [unsynced, synced] = await Promise.all([
        getUnsyncedCount(user.uid),
        getSyncedCount(user.uid),
      ]);
      setUnsyncedCount(unsynced);
      setSyncedCount(synced);
    } catch (error) {
      console.error('Error loading location counts:', error);
    }
  }, [user?.uid, isSatpam]);

  // Initial load
  React.useEffect(() => {
    loadLocationCounts();
  }, [loadLocationCounts]);

  // Refresh counts when lastSyncTime changes (auto-sync completed)
  React.useEffect(() => {
    if (lastSyncTime) {
      loadLocationCounts();
    }
  }, [lastSyncTime, loadLocationCounts]);

  // Periodic refresh of counts every 30 seconds (to catch background sync updates)
  React.useEffect(() => {
    if (!isSatpam) return;

    const interval = setInterval(() => {
      loadLocationCounts();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [isSatpam, loadLocationCounts]);

  // Refresh counts when app comes to foreground
  React.useEffect(() => {
    const appStateRef = { current: AppState.currentState };

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isSatpam
      ) {
        // App came to foreground, refresh counts and last sync time
        loadLocationCounts();
        refreshLastSyncTime();
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isSatpam, loadLocationCounts, refreshLastSyncTime]);

  // Format cooldown time for display
  const formatCooldownTime = (ms: number) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format last sync time for display
  const formatLastSyncTime = (date: Date | null) => {
    if (!date) return 'Never';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Open monitoring WebView for a satpam user
  const openMonitoringWebView = async (satpamUid: string) => {
    const url = `${WEB_BASE_URL}/public/monitoring/${satpamUid}?date=${getTodayDate()}`;
    await WebBrowser.openBrowserAsync(url);
  };

  // Refresh data
  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      const refreshPromises: Promise<unknown>[] = [
        loadLocationCounts(),
        refetchStatus(),
        refreshCheckinStatus(),
        refetchAllocations(),
      ];
      if (!isSatpam) {
        refreshPromises.push(refetchSatpamUsers());
      }
      await Promise.all(refreshPromises);
    } catch (error) {
      console.error('Error refreshing:', error);
    }
    setIsRefreshing(false);
  }, [
    loadLocationCounts,
    refetchStatus,
    refreshCheckinStatus,
    refetchAllocations,
    refetchSatpamUsers,
    isSatpam,
  ]);

  // Handle checkin
  const handleCheckin = async () => {
    try {
      await checkinMutation.mutateAsync(new Date());
      await refreshCheckinStatus();
      Alert.alert('Success', 'Checked in successfully! Location tracking is now active.');
    } catch (error: any) {
      Alert.alert('Checkin Failed', error.response?.data?.message || 'Failed to check in');
    }
  };

  // Handle checkout
  const handleCheckout = async () => {
    Alert.alert(
      'Confirm Checkout',
      'Are you sure you want to check out? Location tracking will stop.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Checkout',
          style: 'destructive',
          onPress: async () => {
            try {
              await checkoutMutation.mutateAsync(new Date());
              await refreshCheckinStatus();
              Alert.alert('Success', 'Checked out successfully!');
            } catch (error: any) {
              Alert.alert(
                'Checkout Failed',
                error.response?.data?.message || 'Failed to check out'
              );
            }
          },
        },
      ]
    );
  };

  // Handle sync (manual)
  const handleSync = async () => {
    if (!user?.uid || isSyncing) return;
    try {
      const result = await syncNow();
      if (result) {
        Alert.alert(
          'Sync Complete',
          `Sent ${result.sent} records to server, deleted ${result.deleted} from storage`
        );
        await loadLocationCounts();
      } else {
        Alert.alert('Sync Skipped', 'No internet connection or no records to sync');
      }
    } catch (error: any) {
      Alert.alert('Sync Failed', error.response?.data?.message || 'Failed to sync locations');
    }
  };

  // Handle logout
  const handleLogout = async () => {
    Alert.alert('Confirm Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  // Handle emergency button press
  const handleEmergency = async () => {
    if (isEmergencyCooldown || panicButtonMutation.isPending) return;

    Alert.alert(
      '🚨 EMERGENCY ALERT',
      'This will send an emergency alert with your current location. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'SEND ALERT',
          style: 'destructive',
          onPress: async () => {
            try {
              const payload = {
                latitude: lastLocation?.coords.latitude ?? 0,
                longitude: lastLocation?.coords.longitude ?? 0,
                pressed_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
                notes: 'EMERGENCY ALERT',
              };

              await panicButtonMutation.mutateAsync(payload);
              setLastEmergencyTime(Date.now());
              Alert.alert('✅ Alert Sent', 'Emergency alert has been sent to the security team!');
            } catch (error: any) {
              Alert.alert(
                'Failed to Send',
                error.response?.data?.message || 'Failed to send emergency alert'
              );
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="flex-row items-center justify-between bg-white px-4 py-3 shadow-sm">
        <Text className="text-xl font-bold text-gray-900">Siaga Kebun</Text>
        <Pressable
          onPress={handleLogout}
          className="rounded-full bg-gray-100 p-2 active:bg-gray-200">
          <Icon as={LogOutIcon} size={22} className="text-gray-600" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#7bed9a']}
            tintColor="#7bed9a"
          />
        }>
        {/* User Info Card */}
        <View className="mb-4 rounded-2xl bg-[#7bed9a] p-5 shadow-lg">
          <View className="flex-row items-center">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-white/30">
              <Icon as={UserIcon} size={32} className="text-white" />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-xl font-bold text-white">{user?.name}</Text>
              <Text className="text-sm text-white/80">@{user?.username}</Text>
              <View className="mt-1 flex-row items-center">
                <View className="rounded-full bg-white/30 px-3 py-1">
                  <Text className="text-xs font-semibold text-white">{user?.level}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Tracking Status - Only show for SATPAM */}
          {isSatpam && (
            <View className="mt-4 flex-row items-center rounded-xl bg-white/20 px-4 py-3">
              <View
                className={cn(
                  'h-3 w-3 rounded-full',
                  statusReason === 'active' ? 'bg-white' : 'bg-red-400'
                )}
              />
              <Text className="ml-2 text-sm text-white">
                {statusReason === 'active' ? 'GPS Tracking Active' : 'GPS Tracking Paused'}
              </Text>
              {lastLocation && statusReason === 'active' && (
                <Text className="ml-auto text-xs text-white/80">
                  Last: {new Date(lastLocation.timestamp).toLocaleTimeString()}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Emergency Button - Only show for SATPAM */}
        {isSatpam && (
          <View className="mb-4">
            <Animated.View style={{ transform: [{ scale: bounceAnim }] }}>
              <Pressable
                onPress={handleEmergency}
                disabled={panicButtonMutation.isPending}
                className={cn(
                  'items-center justify-center rounded-2xl py-5 shadow-lg',
                  isEmergencyCooldown
                    ? 'bg-gray-400'
                    : panicButtonMutation.isPending
                      ? 'bg-red-400'
                      : 'bg-red-600 active:bg-red-700'
                )}>
                {panicButtonMutation.isPending ? (
                  <View className="items-center">
                    <ActivityIndicator color="#fff" size="large" />
                    <Text className="mt-2 text-lg font-bold text-white">Sending Emergency...</Text>
                  </View>
                ) : isEmergencyCooldown ? (
                  <View className="items-center">
                    <Icon as={ClockIcon} size={40} className="text-white" />
                    <Text className="mt-2 text-lg font-bold text-white">
                      Please Wait {formatCooldownTime(cooldownRemaining)}
                    </Text>
                    <Text className="text-sm text-white/80">Before sending another alert</Text>
                  </View>
                ) : (
                  <View className="items-center">
                    <Icon as={AlertTriangleIcon} size={40} className="text-white" />
                    <Text className="mt-2 text-lg font-bold text-white">🚨 EMERGENCY</Text>
                    <Text className="text-sm text-white/80">Tap to send emergency alert</Text>
                  </View>
                )}
              </Pressable>
            </Animated.View>
          </View>
        )}

        {/* Checkin/Checkout Section - Only show for SATPAM */}
        {isSatpam && (
          <View className="mb-4">
            <View className="mb-3 flex-row items-center">
              <Icon as={ClockIcon} size={20} className="text-gray-700" />
              <Text className="ml-2 text-lg font-semibold text-gray-800">Attendance</Text>
            </View>

            {isLoadingStatus ? (
              <View className="items-center rounded-xl border border-gray-100 bg-white py-6">
                <ActivityIndicator color="#7bed9a" />
                <Text className="mt-2 text-sm text-gray-400">Loading status...</Text>
              </View>
            ) : (
              <View className="flex-row gap-3">
                {/* Check In Button */}
                <Pressable
                  onPress={handleCheckin}
                  disabled={hasCheckedIn || checkinMutation.isPending}
                  className={cn(
                    'flex-1 items-center rounded-xl border p-4',
                    hasCheckedIn
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-200 bg-white active:bg-gray-50'
                  )}>
                  {checkinMutation.isPending ? (
                    <ActivityIndicator color="#7bed9a" />
                  ) : (
                    <>
                      <View
                        className={cn(
                          'mb-2 h-12 w-12 items-center justify-center rounded-full',
                          hasCheckedIn ? 'bg-green-100' : 'bg-gray-100'
                        )}>
                        <Icon
                          as={hasCheckedIn ? CheckCircleIcon : LogInIcon}
                          size={24}
                          className={hasCheckedIn ? 'text-green-600' : 'text-gray-600'}
                        />
                      </View>
                      <Text
                        className={cn(
                          'font-semibold',
                          hasCheckedIn ? 'text-green-600' : 'text-gray-800'
                        )}>
                        {hasCheckedIn ? 'Checked In' : 'Check In'}
                      </Text>
                    </>
                  )}
                </Pressable>

                {/* Check Out Button */}
                <Pressable
                  onPress={handleCheckout}
                  disabled={!hasCheckedIn || hasCheckedOut || checkoutMutation.isPending}
                  className={cn(
                    'flex-1 items-center rounded-xl border p-4',
                    hasCheckedOut
                      ? 'border-blue-200 bg-blue-50'
                      : !hasCheckedIn
                        ? 'border-gray-100 bg-gray-50'
                        : 'border-gray-200 bg-white active:bg-gray-50'
                  )}>
                  {checkoutMutation.isPending ? (
                    <ActivityIndicator color="#7bed9a" />
                  ) : (
                    <>
                      <View
                        className={cn(
                          'mb-2 h-12 w-12 items-center justify-center rounded-full',
                          hasCheckedOut
                            ? 'bg-blue-100'
                            : !hasCheckedIn
                              ? 'bg-gray-100'
                              : 'bg-gray-100'
                        )}>
                        <Icon
                          as={hasCheckedOut ? CheckCircleIcon : LogOutIcon}
                          size={24}
                          className={
                            hasCheckedOut
                              ? 'text-blue-600'
                              : !hasCheckedIn
                                ? 'text-gray-300'
                                : 'text-gray-600'
                          }
                        />
                      </View>
                      <Text
                        className={cn(
                          'font-semibold',
                          hasCheckedOut
                            ? 'text-blue-600'
                            : !hasCheckedIn
                              ? 'text-gray-300'
                              : 'text-gray-800'
                        )}>
                        {hasCheckedOut ? 'Checked Out' : 'Check Out'}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {/* Tracking Status Info */}
            {trackingError && (
              <View className="mt-3 flex-row items-center rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <Icon as={AlertCircleIcon} size={16} className="text-red-500" />
                <Text className="ml-2 flex-1 text-xs text-red-600">{trackingError}</Text>
              </View>
            )}

            {statusReason !== 'active' && !trackingError && (
              <View
                className={cn(
                  'mt-3 flex-row items-center rounded-lg border px-3 py-2',
                  trackingStatusInfo.type === 'warning'
                    ? 'border-yellow-200 bg-yellow-50'
                    : trackingStatusInfo.type === 'error'
                      ? 'border-red-200 bg-red-50'
                      : 'border-blue-200 bg-blue-50'
                )}>
                <Icon
                  as={InfoIcon}
                  size={16}
                  className={
                    trackingStatusInfo.type === 'warning'
                      ? 'text-yellow-600'
                      : trackingStatusInfo.type === 'error'
                        ? 'text-red-500'
                        : 'text-blue-500'
                  }
                />
                <Text
                  className={cn(
                    'ml-2 flex-1 text-xs',
                    trackingStatusInfo.type === 'warning'
                      ? 'text-yellow-700'
                      : trackingStatusInfo.type === 'error'
                        ? 'text-red-600'
                        : 'text-blue-600'
                  )}>
                  {trackingStatusInfo.message}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Sync Section - Only show for SATPAM */}
        {isSatpam && (
          <View className="mb-4">
            {/* Sync stats row */}
            <View className="mb-3 flex-row gap-3">
              {/* Synced count card */}
              <View className="flex-1 rounded-xl border border-green-200 bg-green-50 p-3">
                <View className="flex-row items-center">
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-green-100">
                    <Icon as={CheckCircleIcon} size={18} className="text-green-600" />
                  </View>
                  <View className="ml-2 flex-1">
                    <Text className="text-lg font-bold text-green-700">{syncedCount}</Text>
                    <Text className="text-xs text-green-600">Synced</Text>
                  </View>
                </View>
              </View>

              {/* Pending count card */}
              <View className="flex-1 rounded-xl border border-orange-200 bg-orange-50 p-3">
                <View className="flex-row items-center">
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-orange-100">
                    <Icon as={CloudUploadIcon} size={18} className="text-orange-600" />
                  </View>
                  <View className="ml-2 flex-1">
                    <Text className="text-lg font-bold text-orange-700">{unsyncedCount}</Text>
                    <Text className="text-xs text-orange-600">Pending</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Auto-sync status */}
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center">
                <Icon as={RefreshCwIcon} size={14} className="text-gray-400" />
                <Text className="ml-1 text-xs text-gray-500">Auto-sync every 5 mins</Text>
              </View>
              <Text className="text-xs text-gray-400">
                Last sync: {formatLastSyncTime(lastSyncTime)}
              </Text>
            </View>

            {/* Manual sync button */}
            <Pressable
              onPress={handleSync}
              disabled={isSyncing || unsyncedCount === 0}
              className={cn(
                'flex-row items-center justify-center rounded-xl border p-4',
                unsyncedCount > 0
                  ? 'border-orange-200 bg-orange-50 active:bg-orange-100'
                  : 'border-gray-100 bg-gray-50'
              )}>
              {isSyncing ? (
                <ActivityIndicator color="#f97316" />
              ) : (
                <>
                  <Icon
                    as={CloudUploadIcon}
                    size={24}
                    className={unsyncedCount > 0 ? 'text-orange-500' : 'text-gray-400'}
                  />
                  <Text
                    className={cn(
                      'ml-2 font-semibold',
                      unsyncedCount > 0 ? 'text-orange-600' : 'text-gray-400'
                    )}>
                    {unsyncedCount > 0
                      ? `Sync ${unsyncedCount} Pending Location${unsyncedCount > 1 ? 's' : ''}`
                      : 'All Locations Synced'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Work Allocations Section - Only show for SATPAM */}
        {isSatpam && (
          <View className="mb-4">
            <View className="mb-3 flex-row items-center">
              <Icon as={BriefcaseIcon} size={20} className="text-gray-700" />
              <Text className="ml-2 text-lg font-semibold text-gray-800">Today's Assignment</Text>
            </View>

            {isLoadingAllocations ? (
              <View className="items-center rounded-xl border border-gray-100 bg-white py-6">
                <ActivityIndicator color="#7bed9a" />
                <Text className="mt-2 text-sm text-gray-400">Loading allocations...</Text>
              </View>
            ) : !workAllocations || workAllocations.length === 0 ? (
              <View className="items-center rounded-xl border border-gray-100 bg-white py-6">
                <Icon as={BriefcaseIcon} size={32} className="text-gray-300" />
                <Text className="mt-2 text-sm text-gray-400">No work allocation for today</Text>
              </View>
            ) : (
              <View className="gap-3">
                {workAllocations.map((allocation: WorkAllocation) => (
                  <View
                    key={allocation.id}
                    className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    {/* Shift Info */}
                    <View className="mb-3 flex-row items-center">
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-[#7bed9a]/10">
                        <Icon as={ClockIcon} size={20} className="text-[#7bed9a]" />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-sm font-semibold text-gray-800">
                          {allocation.shift.name}
                        </Text>
                        <Text className="text-xs text-gray-500">
                          {allocation.shift.start_time} - {allocation.shift.end_time}
                        </Text>
                      </View>
                    </View>

                    {/* Area Info */}
                    <View className="flex-row items-center rounded-lg bg-gray-50 px-3 py-2">
                      <Icon as={MapPinIcon} size={16} className="text-blue-500" />
                      <View className="ml-2 flex-1">
                        <Text className="text-sm font-medium text-gray-700">
                          {allocation.area.name}
                        </Text>
                        {allocation.block && (
                          <Text className="text-xs text-gray-500">
                            Block: {allocation.block.name}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Security Officers List Section - Only for non-SATPAM (Managers) */}
        {!isSatpam && (
          <View className="mb-4">
            <View className="mb-3 flex-row items-center">
              <Icon as={UsersIcon} size={20} className="text-gray-700" />
              <Text className="ml-2 text-lg font-semibold text-gray-800">Security Officers</Text>
            </View>

            {/* Manager Info Banner */}
            <View className="mb-3 flex-row items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <Icon as={InfoIcon} size={16} className="text-blue-500" />
              <Text className="ml-2 flex-1 text-xs text-blue-600">
                You are a Manager. Your location will not be tracked.
              </Text>
            </View>

            {isLoadingSatpamUsers ? (
              <View className="items-center rounded-xl border border-gray-100 bg-white py-6">
                <ActivityIndicator color="#7bed9a" />
                <Text className="mt-2 text-sm text-gray-400">Loading security officers...</Text>
              </View>
            ) : !satpamUsers || satpamUsers.length === 0 ? (
              <View className="items-center rounded-xl border border-gray-100 bg-white py-6">
                <Icon as={UsersIcon} size={32} className="text-gray-300" />
                <Text className="mt-2 text-sm text-gray-400">No security officers found</Text>
              </View>
            ) : (
              <View className="gap-2">
                {satpamUsers.map((satpam: SatpamUser) => (
                  <Pressable
                    key={satpam.uid}
                    onPress={() => openMonitoringWebView(satpam.uid)}
                    className="flex-row items-center rounded-xl border border-gray-100 bg-white p-4 shadow-sm active:bg-gray-50">
                    <View className="h-12 w-12 items-center justify-center rounded-full bg-[#7bed9a]/10">
                      <Icon as={ShieldIcon} size={24} className="text-[#7bed9a]" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-semibold text-gray-800">{satpam.name}</Text>
                      {satpam.shift ? (
                        <View className="mt-1 flex-row items-center">
                          <Icon as={ClockIcon} size={12} className="text-gray-400" />
                          <Text className="ml-1 text-xs text-gray-500">
                            {satpam.shift.name} ({satpam.shift.start_time} - {satpam.shift.end_time}
                            )
                          </Text>
                        </View>
                      ) : (
                        <Text className="mt-1 text-xs text-gray-400">No shift assigned</Text>
                      )}
                    </View>
                    <Icon as={ChevronRightIcon} size={20} className="text-gray-400" />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
