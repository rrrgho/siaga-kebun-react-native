import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  SatpamUser,
  useCheckin,
  useCheckout,
  usePanicButton,
  useSatpamUsers,
  useSyncLocations,
  useTodayStatus,
  useTodayWorkAllocations,
} from '@/lib/api-hooks';
import { WEB_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  getLocationRecords,
  getUnsyncedCount,
  LocationRecord,
  WorkAllocation,
} from '@/lib/database';
import { getTrackingStatusMessage, useLocationTracker } from '@/lib/location-tracker';
import { cn } from '@/lib/utils';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
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
  XCircleIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ITEMS_PER_PAGE = 20;
const EMERGENCY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const {
    isTracking,
    lastLocation,
    error: trackingError,
    statusReason,
    refreshCheckinStatus,
  } = useLocationTracker();
  const checkinMutation = useCheckin();
  const checkoutMutation = useCheckout();
  const syncMutation = useSyncLocations();
  const panicButtonMutation = usePanicButton();

  // Check if user is SATPAM (security officer)
  const isSatpam = user?.level === 'SATPAM';

  // Emergency button state
  const [lastEmergencyTime, setLastEmergencyTime] = React.useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = React.useState<number>(0);
  const bounceAnim = React.useRef(new Animated.Value(1)).current;

  // Today status only for SATPAM users (with offline support)
  const {
    data: todayStatus,
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
  } = useTodayStatus(isSatpam ? user?.uid : undefined);

  // Work allocations only for SATPAM users
  const {
    data: workAllocations,
    isLoading: isLoadingAllocations,
    refetch: refetchAllocations,
  } = useTodayWorkAllocations(isSatpam ? user?.uid : undefined);

  // Fetch satpam users list (only for non-SATPAM users)
  const {
    data: satpamUsers,
    isLoading: isLoadingSatpamUsers,
    refetch: refetchSatpamUsers,
  } = useSatpamUsers(!isSatpam);

  const [locationRecords, setLocationRecords] = React.useState<LocationRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [unsyncedCount, setUnsyncedCount] = React.useState(0);

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

  // Format cooldown time for display
  const formatCooldownTime = (ms: number) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

  // Load initial data (only for SATPAM users)
  const loadData = React.useCallback(async () => {
    if (!user?.uid || user?.level !== 'SATPAM') return;

    try {
      const [records, count] = await Promise.all([
        getLocationRecords(user.uid, ITEMS_PER_PAGE, 0),
        getUnsyncedCount(user.uid),
      ]);
      setLocationRecords(records);
      setUnsyncedCount(count);
      setHasMore(records.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, [user?.uid, user?.level]);

  // Refresh data
  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    const refreshPromises: Promise<unknown>[] = [
      loadData(),
      refetchStatus(),
      refreshCheckinStatus(),
      refetchAllocations(),
    ];
    if (!isSatpam) {
      refreshPromises.push(refetchSatpamUsers());
    }
    await Promise.all(refreshPromises);
    setIsRefreshing(false);
  }, [
    loadData,
    refetchStatus,
    refreshCheckinStatus,
    refetchAllocations,
    refetchSatpamUsers,
    isSatpam,
  ]);

  // Load more data
  const handleLoadMore = React.useCallback(async () => {
    if (!user?.uid || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const moreRecords = await getLocationRecords(
        user.uid,
        ITEMS_PER_PAGE,
        locationRecords.length
      );
      setLocationRecords((prev) => [...prev, ...moreRecords]);
      setHasMore(moreRecords.length === ITEMS_PER_PAGE);
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    setIsLoadingMore(false);
  }, [user?.uid, isLoadingMore, hasMore, locationRecords.length]);

  // Initial load
  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh data when sync completes
  React.useEffect(() => {
    if (syncMutation.isSuccess) {
      loadData();
    }
  }, [syncMutation.isSuccess, loadData]);

  // Handle checkin
  const handleCheckin = async () => {
    try {
      await checkinMutation.mutateAsync(new Date());
      // Refresh tracking status after checkin
      await refreshCheckinStatus();
      Alert.alert('Success', 'Checked in successfully! Location tracking is now active.');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to check in';
      Alert.alert('Error', message);
    }
  };

  // Handle checkout
  const handleCheckout = async () => {
    try {
      await checkoutMutation.mutateAsync(new Date());
      // Refresh tracking status after checkout
      await refreshCheckinStatus();
      Alert.alert('Success', 'Checked out successfully! Location tracking is now paused.');
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to check out';
      Alert.alert('Error', message);
    }
  };

  // Handle sync
  const handleSync = async () => {
    if (!user?.uid) return;

    try {
      const result = await syncMutation.mutateAsync(user.uid);
      Alert.alert('Success', result.message);
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to sync locations';
      Alert.alert('Error', message);
    }
  };

  // Handle logout
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
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
    if (isEmergencyCooldown) {
      Alert.alert(
        'Please Wait',
        `You can send another emergency alert in ${formatCooldownTime(cooldownRemaining)}. Please wait before trying again.`
      );
      return;
    }

    // Confirm before sending emergency
    Alert.alert(
      '🚨 Emergency Alert',
      'Are you sure you want to send an emergency rescue request? This will alert the response team immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'SEND EMERGENCY',
          style: 'destructive',
          onPress: async () => {
            try {
              // Use current location if available, otherwise use default
              const latitude = lastLocation?.coords.latitude ?? -6.2088;
              const longitude = lastLocation?.coords.longitude ?? 106.8456;

              await panicButtonMutation.mutateAsync({
                latitude,
                longitude,
                notes: 'SEND EMERGENCY RESCUE',
              });

              // Set cooldown
              setLastEmergencyTime(Date.now());

              Alert.alert(
                '✅ Emergency Sent',
                'Your emergency alert has been sent successfully. Help is on the way!',
                [{ text: 'OK' }]
              );
            } catch (error: any) {
              const message = error?.response?.data?.message || 'Failed to send emergency alert';
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Render location record item
  const renderLocationItem = ({ item }: { item: LocationRecord }) => (
    <View className="mb-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <View className="mb-2 flex-row items-center">
            <Icon as={MapPinIcon} size={16} className="text-[#7bed9a]" />
            <Text className="ml-2 text-sm font-medium text-gray-800">
              {formatDate(item.recorded_at)}
            </Text>
          </View>
          <View className="ml-6">
            <Text className="text-xs text-gray-500">Lat: {item.latitude.toFixed(6)}</Text>
            <Text className="text-xs text-gray-500">Lng: {item.longitude.toFixed(6)}</Text>
          </View>
        </View>
        <View
          className={cn(
            'flex-row items-center rounded-full px-3 py-1',
            item.synced ? 'bg-green-100' : 'bg-orange-100'
          )}>
          <Icon
            as={item.synced ? CheckCircleIcon : XCircleIcon}
            size={14}
            className={item.synced ? 'text-green-600' : 'text-orange-500'}
          />
          <Text
            className={cn(
              'ml-1 text-xs font-medium',
              item.synced ? 'text-green-600' : 'text-orange-500'
            )}>
            {item.synced ? 'Synced' : 'Pending'}
          </Text>
        </View>
      </View>
    </View>
  );

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

      <FlatList
        data={isSatpam ? locationRecords : []}
        keyExtractor={(item) => item.id?.toString() ?? item.recorded_at}
        renderItem={renderLocationItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={['#7bed9a']}
            tintColor="#7bed9a"
          />
        }
        onEndReached={isSatpam ? handleLoadMore : undefined}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <>
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
                        <Text className="mt-2 text-lg font-bold text-white">
                          Sending Emergency...
                        </Text>
                      </View>
                    ) : isEmergencyCooldown ? (
                      <View className="items-center">
                        <Icon as={ClockIcon} size={40} className="text-white" />
                        <Text className="mt-2 text-lg font-bold text-white">
                          Please Wait {formatCooldownTime(cooldownRemaining)}
                        </Text>
                        <Text className="mt-1 text-sm text-white/80">
                          You can send another alert after cooldown
                        </Text>
                      </View>
                    ) : (
                      <View className="items-center">
                        <Icon as={AlertTriangleIcon} size={40} className="text-white" />
                        <Text className="mt-2 text-xl font-bold text-white">
                          🚨 EMERGENCY BUTTON
                        </Text>
                        <Text className="mt-1 text-sm text-white/90">
                          Press to send emergency rescue alert
                        </Text>
                      </View>
                    )}
                  </Pressable>
                </Animated.View>
                {isEmergencyCooldown && (
                  <Text className="mt-2 text-center text-xs text-gray-500">
                    Emergency alerts have a 5-minute cooldown between requests
                  </Text>
                )}
              </View>
            )}

            {/* Tracking Status Message - Show when not actively tracking (SATPAM only) */}
            {isSatpam && statusReason !== 'active' && statusReason !== 'stopped' && (
              <View
                className={cn(
                  'mb-4 flex-row items-center rounded-xl p-4',
                  trackingStatusInfo.type === 'warning' && 'border border-amber-200 bg-amber-50',
                  trackingStatusInfo.type === 'info' && 'border border-blue-200 bg-blue-50',
                  trackingStatusInfo.type === 'error' && 'border border-red-200 bg-red-50'
                )}>
                <View
                  className={cn(
                    'h-10 w-10 items-center justify-center rounded-full',
                    trackingStatusInfo.type === 'warning' && 'bg-amber-100',
                    trackingStatusInfo.type === 'info' && 'bg-blue-100',
                    trackingStatusInfo.type === 'error' && 'bg-red-100'
                  )}>
                  <Icon
                    as={trackingStatusInfo.type === 'warning' ? AlertCircleIcon : InfoIcon}
                    size={22}
                    className={cn(
                      trackingStatusInfo.type === 'warning' && 'text-amber-600',
                      trackingStatusInfo.type === 'info' && 'text-blue-600',
                      trackingStatusInfo.type === 'error' && 'text-red-600'
                    )}
                  />
                </View>
                <View className="ml-3 flex-1">
                  <Text
                    className={cn(
                      'text-sm font-semibold',
                      trackingStatusInfo.type === 'warning' && 'text-amber-800',
                      trackingStatusInfo.type === 'info' && 'text-blue-800',
                      trackingStatusInfo.type === 'error' && 'text-red-800'
                    )}>
                    {trackingStatusInfo.title}
                  </Text>
                  <Text
                    className={cn(
                      'mt-0.5 text-xs',
                      trackingStatusInfo.type === 'warning' && 'text-amber-600',
                      trackingStatusInfo.type === 'info' && 'text-blue-600',
                      trackingStatusInfo.type === 'error' && 'text-red-600'
                    )}>
                    {trackingStatusInfo.message}
                  </Text>
                </View>
              </View>
            )}

            {/* Action Buttons - Only show for SATPAM */}
            {isSatpam && (
              <View className="mb-4 flex-row gap-3">
                <View className="flex-1">
                  <Button
                    onPress={handleCheckin}
                    disabled={checkinMutation.isPending || hasCheckedIn || isLoadingStatus}
                    className={cn(
                      'h-14 w-full flex-row items-center justify-center rounded-xl',
                      hasCheckedIn
                        ? 'bg-gray-300'
                        : checkinMutation.isPending
                          ? 'bg-[#7bed9a]/50'
                          : 'bg-[#7bed9a]'
                    )}>
                    {checkinMutation.isPending || isLoadingStatus ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : hasCheckedIn ? (
                      <>
                        <Icon as={CheckCircleIcon} size={20} className="text-white" />
                        <Text className="ml-2 font-semibold text-white">Checked In</Text>
                      </>
                    ) : (
                      <>
                        <Icon as={LogInIcon} size={20} className="text-white" />
                        <Text className="ml-2 font-semibold text-white">Check In</Text>
                      </>
                    )}
                  </Button>
                  {hasCheckedIn && (
                    <Text className="mt-1 text-center text-xs text-green-600">
                      ✓ You have checked in today
                    </Text>
                  )}
                </View>

                <View className="flex-1">
                  <Button
                    onPress={handleCheckout}
                    disabled={
                      checkoutMutation.isPending ||
                      hasCheckedOut ||
                      !hasCheckedIn ||
                      isLoadingStatus
                    }
                    className={cn(
                      'h-14 w-full flex-row items-center justify-center rounded-xl border-2',
                      hasCheckedOut
                        ? 'border-gray-300 bg-gray-100'
                        : !hasCheckedIn
                          ? 'border-gray-300 bg-gray-100'
                          : 'border-[#7bed9a] bg-white'
                    )}>
                    {checkoutMutation.isPending || isLoadingStatus ? (
                      <ActivityIndicator color="#7bed9a" size="small" />
                    ) : hasCheckedOut ? (
                      <>
                        <Icon as={CheckCircleIcon} size={20} className="text-gray-400" />
                        <Text className="ml-2 font-semibold text-gray-400">Checked Out</Text>
                      </>
                    ) : (
                      <>
                        <Icon
                          as={LogOutIcon}
                          size={20}
                          className={hasCheckedIn ? 'text-[#7bed9a]' : 'text-gray-400'}
                        />
                        <Text
                          className={cn(
                            'ml-2 font-semibold',
                            hasCheckedIn ? 'text-[#7bed9a]' : 'text-gray-400'
                          )}>
                          Check Out
                        </Text>
                      </>
                    )}
                  </Button>
                  {hasCheckedOut && (
                    <Text className="mt-1 text-center text-xs text-green-600">
                      ✓ You have checked out today
                    </Text>
                  )}
                  {!hasCheckedIn && !hasCheckedOut && (
                    <Text className="mt-1 text-center text-xs text-gray-400">Check in first</Text>
                  )}
                </View>
              </View>
            )}

            {/* Sync Button - Only show for SATPAM */}
            {isSatpam && (
              <Button
                onPress={handleSync}
                disabled={syncMutation.isPending || unsyncedCount === 0}
                className={cn(
                  'mb-4 h-14 w-full flex-row items-center justify-center rounded-xl',
                  unsyncedCount === 0
                    ? 'bg-gray-200'
                    : syncMutation.isPending
                      ? 'bg-blue-400/50'
                      : 'bg-blue-500'
                )}>
                {syncMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Icon as={CloudUploadIcon} size={20} className="text-white" />
                    <Text className="ml-2 font-semibold text-white">
                      Upload Locations {unsyncedCount > 0 ? `(${unsyncedCount} pending)` : ''}
                    </Text>
                  </>
                )}
              </Button>
            )}

            {/* Work Allocation Section */}
            <View className="mb-4">
              <View className="mb-3 flex-row items-center">
                <Icon as={BriefcaseIcon} size={20} className="text-gray-700" />
                <Text className="ml-2 text-lg font-semibold text-gray-800">
                  Today's Work Allocation
                </Text>
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

            {/* Location History Section - Only for SATPAM */}
            {isSatpam && (
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-semibold text-gray-800">Location History</Text>
                <Pressable onPress={handleRefresh} className="rounded-full p-2 active:bg-gray-100">
                  <Icon
                    as={RefreshCwIcon}
                    size={18}
                    className={cn('text-gray-500', isRefreshing && 'animate-spin')}
                  />
                </Pressable>
              </View>
            )}

            {/* Security Officers List Section - Only for non-SATPAM (Managers) */}
            {!isSatpam && (
              <View className="mb-4">
                <View className="mb-3 flex-row items-center">
                  <Icon as={UsersIcon} size={20} className="text-gray-700" />
                  <Text className="ml-2 text-lg font-semibold text-gray-800">
                    Security Officers
                  </Text>
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
                                {satpam.shift.name} ({satpam.shift.start_time} -{' '}
                                {satpam.shift.end_time})
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
          </>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4">
              <ActivityIndicator color="#7bed9a" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          isSatpam ? (
            <View className="items-center py-8">
              <Icon as={MapPinIcon} size={48} className="text-gray-300" />
              <Text className="mt-2 text-gray-400">No location records yet</Text>
              <Text className="text-sm text-gray-400">Your GPS locations will appear here</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
