import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  useFetchDangerousAreas,
  useLocalDangerousAreas,
  useUploadAllDangerousAreas,
} from '@/lib/api-hooks';
import { WEB_BASE_URL } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { DangerousArea, getUnsyncedDangerousAreasCount } from '@/lib/database';
import { cn } from '@/lib/utils';
import { router } from 'expo-router';
import {
  AlertTriangleIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
  UserIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const getRiskColor = (risk: string) => {
  switch (risk) {
    case 'low':
      return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
    case 'medium':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' };
    case 'high':
      return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
  }
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface DangerAreaItemProps {
  item: DangerousArea;
}

function DangerAreaItem({ item }: DangerAreaItemProps) {
  const riskColors = getRiskColor(item.risk);
  const photoUrl = item.photo?.startsWith('http')
    ? item.photo
    : item.photo?.startsWith('file')
      ? item.photo
      : `${WEB_BASE_URL}/storage/${item.photo}`;

  return (
    <View className="mb-3 overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Photo */}
      <View className="relative h-40 w-full bg-gray-200">
        <Image
          source={{ uri: photoUrl }}
          className="h-full w-full"
          resizeMode="cover"
          onError={(e) => console.log('Image load error:', e.nativeEvent.error)}
        />
        {/* Sync status badge */}
        <View
          className={cn(
            'absolute right-2 top-2 rounded-full px-2 py-1',
            item.synced ? 'bg-green-500' : 'bg-orange-500'
          )}>
          <Text className="text-xs font-medium text-white">
            {item.synced ? 'Synced' : 'Not Synced'}
          </Text>
        </View>
        {/* Risk badge */}
        <View
          className={cn(
            'absolute left-2 top-2 rounded-full px-3 py-1',
            riskColors.bg,
            riskColors.border,
            'border'
          )}>
          <Text className={cn('text-xs font-semibold capitalize', riskColors.text)}>
            {item.risk} Risk
          </Text>
        </View>
      </View>

      {/* Content */}
      <View className="p-3">
        <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
          {item.name || 'Unnamed Area'}
        </Text>

        {/* Location */}
        <View className="mt-2 flex-row items-center">
          <Icon as={MapPinIcon} size={14} className="mr-1 text-gray-400" />
          <Text className="flex-1 text-xs text-gray-500" numberOfLines={1}>
            {parseFloat(item.latitude).toFixed(6)}, {parseFloat(item.longitude).toFixed(6)}
          </Text>
        </View>

        {/* Reporter */}
        {item.user && (
          <View className="mt-1 flex-row items-center">
            <Icon as={UserIcon} size={14} className="mr-1 text-gray-400" />
            <Text className="flex-1 text-xs text-gray-500" numberOfLines={1}>
              {item.user.name}
            </Text>
          </View>
        )}

        {/* Date */}
        <Text className="mt-2 text-xs text-gray-400">{formatDate(item.created_at)}</Text>
      </View>
    </View>
  );
}

export default function DangerAreaScreen() {
  const { user } = useAuth();
  const isSatpam = user?.level === 'SATPAM';

  const { data: dangerousAreas, isLoading, refetch } = useLocalDangerousAreas();
  const fetchMutation = useFetchDangerousAreas();
  const uploadMutation = useUploadAllDangerousAreas();

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [unsyncedCount, setUnsyncedCount] = React.useState(0);

  // Update unsynced count
  React.useEffect(() => {
    const count = getUnsyncedDangerousAreasCount();
    setUnsyncedCount(count);
  }, [dangerousAreas]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setUnsyncedCount(getUnsyncedDangerousAreasCount());
    setIsRefreshing(false);
  };

  const handleDownloadFromServer = async () => {
    try {
      const result = await fetchMutation.mutateAsync();
      Alert.alert('Success', result.message);
      setUnsyncedCount(getUnsyncedDangerousAreasCount());
    } catch (error: any) {
      console.error('Failed to fetch dangerous areas:', error);
      Alert.alert(
        'Error',
        error.response?.data?.message || 'Failed to download data from server. Please try again.'
      );
    }
  };

  const handleUploadToServer = async () => {
    if (unsyncedCount === 0) {
      Alert.alert('Info', 'No unsynced data to upload.');
      return;
    }

    Alert.alert('Upload Danger Areas', `Upload ${unsyncedCount} danger area(s) to server?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Upload',
        onPress: async () => {
          try {
            const result = await uploadMutation.mutateAsync();
            if (result.failed && result.failed > 0) {
              Alert.alert('Partial Success', result.message);
            } else {
              Alert.alert('Success', result.message);
            }
            setUnsyncedCount(getUnsyncedDangerousAreasCount());
          } catch (error: any) {
            console.error('Failed to upload dangerous areas:', error);
            Alert.alert(
              'Error',
              error.response?.data?.message || 'Failed to upload data. Please try again.'
            );
          }
        },
      },
    ]);
  };

  const handleAddDangerArea = () => {
    router.push('/add-danger-area');
  };

  const renderEmptyList = () => (
    <View className="flex-1 items-center justify-center p-6">
      <View className="items-center rounded-2xl bg-white p-8 shadow-sm">
        <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-orange-100">
          <Icon as={AlertTriangleIcon} size={48} className="text-orange-500" />
        </View>
        <Text className="text-xl font-semibold text-gray-800">No Danger Areas</Text>
        <Text className="mt-2 text-center text-gray-500">
          Download data from server or add{'\n'}new danger areas to get started.
        </Text>
        <Button
          onPress={handleDownloadFromServer}
          disabled={fetchMutation.isPending}
          className="mt-4 rounded-xl bg-[#7bed9a] px-6">
          {fetchMutation.isPending ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Icon as={CloudDownloadIcon} size={18} className="mr-2 text-gray-800" />
              <Text className="font-semibold text-gray-800">Download from Server</Text>
            </>
          )}
        </Button>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-white px-4 py-3 shadow-sm">
        <Text className="text-xl font-bold text-gray-900">Danger Area</Text>
        <Text className="mt-1 text-sm text-gray-500">
          {dangerousAreas?.length ?? 0} areas recorded
          {unsyncedCount > 0 && (
            <Text className="text-orange-500"> • {unsyncedCount} not synced</Text>
          )}
        </Text>
      </View>

      {/* Sync Buttons */}
      <View className="flex-row gap-2 bg-white px-4 pb-3">
        <Pressable
          onPress={handleDownloadFromServer}
          disabled={fetchMutation.isPending}
          className={cn(
            'flex-1 flex-row items-center justify-center rounded-xl border border-gray-200 bg-gray-50 py-2.5',
            fetchMutation.isPending && 'opacity-50'
          )}>
          {fetchMutation.isPending ? (
            <ActivityIndicator size="small" color="#6b7280" />
          ) : (
            <>
              <Icon as={CloudDownloadIcon} size={16} className="mr-2 text-gray-600" />
              <Text className="text-sm font-medium text-gray-600">Download</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={handleUploadToServer}
          disabled={uploadMutation.isPending || unsyncedCount === 0}
          className={cn(
            'flex-1 flex-row items-center justify-center rounded-xl py-2.5',
            unsyncedCount > 0 ? 'bg-[#7bed9a]' : 'bg-gray-100',
            uploadMutation.isPending && 'opacity-50'
          )}>
          {uploadMutation.isPending ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Icon
                as={CloudUploadIcon}
                size={16}
                className={unsyncedCount > 0 ? 'mr-2 text-gray-800' : 'mr-2 text-gray-400'}
              />
              <Text
                className={cn(
                  'text-sm font-medium',
                  unsyncedCount > 0 ? 'text-gray-800' : 'text-gray-400'
                )}>
                Upload ({unsyncedCount})
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#7bed9a" />
          <Text className="mt-4 text-gray-500">Loading danger areas...</Text>
        </View>
      ) : (
        <FlatList
          data={dangerousAreas}
          keyExtractor={(item) => String(item.local_id ?? item.id)}
          renderItem={({ item }) => <DangerAreaItem item={item} />}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 100, // Space for FAB
            flexGrow: 1,
          }}
          ListEmptyComponent={renderEmptyList}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={['#7bed9a']}
              tintColor="#7bed9a"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Action Button - Only for SATPAM users */}
      {isSatpam && (
        <Pressable
          onPress={handleAddDangerArea}
          className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-[#7bed9a] shadow-lg"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 4.65,
            elevation: 8,
          }}>
          <Icon as={PlusIcon} size={28} className="text-gray-800" />
        </Pressable>
      )}
    </SafeAreaView>
  );
}
