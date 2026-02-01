import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useActiveMapImages } from '@/lib/api-hooks';
import {
  getAllMapImages,
  getMapImageById,
  MapImage,
  updateMapImageLocalPath,
  markMapAsNotDownloaded,
} from '@/lib/database';
import { cn } from '@/lib/utils';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import {
  CheckCircleIcon,
  CloudDownloadIcon,
  DownloadIcon,
  MapIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react-native';
import * as React from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Directory for storing downloaded map images
const MAP_IMAGES_DIR = `${FileSystem.documentDirectory}map-images/`;

export default function MapScreen() {
  const { data: serverMaps, isLoading, refetch, isRefetching } = useActiveMapImages();
  const [localMaps, setLocalMaps] = React.useState<MapImage[]>([]);
  const [downloadingIds, setDownloadingIds] = React.useState<Set<number>>(new Set());
  const [downloadProgress, setDownloadProgress] = React.useState<Record<number, number>>({});

  // Load local maps on mount
  const loadLocalMaps = React.useCallback(() => {
    const maps = getAllMapImages();
    setLocalMaps(maps);
  }, []);

  React.useEffect(() => {
    loadLocalMaps();
  }, [loadLocalMaps]);

  // Update local maps when server maps are fetched
  React.useEffect(() => {
    if (serverMaps) {
      setLocalMaps(serverMaps);
    }
  }, [serverMaps]);

  // Ensure map images directory exists
  const ensureMapDirectory = async () => {
    const dirInfo = await FileSystem.getInfoAsync(MAP_IMAGES_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MAP_IMAGES_DIR, { intermediates: true });
    }
  };

  // Download map image
  const downloadMap = async (mapImage: MapImage) => {
    if (downloadingIds.has(mapImage.id)) return;

    setDownloadingIds((prev) => new Set(prev).add(mapImage.id));
    setDownloadProgress((prev) => ({ ...prev, [mapImage.id]: 0 }));

    try {
      await ensureMapDirectory();

      // Generate local filename
      const filename = `map_${mapImage.id}_${Date.now()}.png`;
      const localPath = `${MAP_IMAGES_DIR}${filename}`;

      // Download the image with progress
      const downloadResumable = FileSystem.createDownloadResumable(
        mapImage.image_url,
        localPath,
        {},
        (progress) => {
          const percent = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
          setDownloadProgress((prev) => ({ ...prev, [mapImage.id]: percent * 100 }));
        }
      );

      const result = await downloadResumable.downloadAsync();

      if (result?.uri) {
        // Update database with local path
        updateMapImageLocalPath(mapImage.id, result.uri);
        loadLocalMaps();
        Alert.alert('Success', `Map "${mapImage.name}" downloaded successfully!`);
      }
    } catch (error) {
      console.error('Error downloading map:', error);
      Alert.alert('Error', 'Failed to download map image. Please try again.');
    } finally {
      setDownloadingIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(mapImage.id);
        return newSet;
      });
      setDownloadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[mapImage.id];
        return newProgress;
      });
    }
  };

  // Delete downloaded map
  const deleteDownloadedMap = async (mapImage: MapImage) => {
    Alert.alert(
      'Delete Download',
      `Are you sure you want to delete the downloaded map "${mapImage.name}"? You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (mapImage.local_image_path) {
                await FileSystem.deleteAsync(mapImage.local_image_path, { idempotent: true });
              }
              markMapAsNotDownloaded(mapImage.id);
              loadLocalMaps();
              Alert.alert('Deleted', 'Map download has been removed.');
            } catch (error) {
              console.error('Error deleting map:', error);
              Alert.alert('Error', 'Failed to delete map.');
            }
          },
        },
      ]
    );
  };

  // Open fullscreen map viewer
  const openMapViewer = (mapImage: MapImage) => {
    if (!mapImage.downloaded || !mapImage.local_image_path) {
      Alert.alert('Download Required', 'Please download this map first to view it offline.');
      return;
    }
    router.push(`/map-viewer?mapId=${mapImage.id}`);
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refetch();
    loadLocalMaps();
  };

  // Render map item
  const renderMapItem = ({ item }: { item: MapImage }) => {
    const isDownloading = downloadingIds.has(item.id);
    const progress = downloadProgress[item.id] || 0;

    return (
      <Pressable
        onPress={() => openMapViewer(item)}
        disabled={!item.downloaded}
        className={cn(
          'mb-3 rounded-xl border bg-white p-4 shadow-sm',
          item.downloaded ? 'border-green-200 active:bg-gray-50' : 'border-gray-200'
        )}>
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <View className="flex-row items-center">
              <View
                className={cn(
                  'h-10 w-10 items-center justify-center rounded-full',
                  item.downloaded ? 'bg-green-100' : 'bg-gray-100'
                )}>
                <Icon
                  as={MapIcon}
                  size={20}
                  className={item.downloaded ? 'text-green-600' : 'text-gray-500'}
                />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-gray-800">{item.name}</Text>
                {item.description && (
                  <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
                    {item.description}
                  </Text>
                )}
              </View>
            </View>

            {/* Download status */}
            <View className="ml-13 mt-2">
              {item.downloaded ? (
                <View className="flex-row items-center">
                  <Icon as={CheckCircleIcon} size={14} className="text-green-500" />
                  <Text className="ml-1 text-xs text-green-600">Downloaded • Tap to view</Text>
                </View>
              ) : (
                <Text className="text-xs text-gray-400">Not downloaded</Text>
              )}
            </View>

            {/* Download progress */}
            {isDownloading && (
              <View className="ml-13 mt-2">
                <View className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <View
                    className="h-full rounded-full bg-[#7bed9a]"
                    style={{ width: `${progress}%` }}
                  />
                </View>
                <Text className="mt-1 text-xs text-gray-500">
                  Downloading... {Math.round(progress)}%
                </Text>
              </View>
            )}
          </View>

          {/* Action buttons */}
          <View className="ml-2">
            {isDownloading ? (
              <ActivityIndicator color="#7bed9a" size="small" />
            ) : item.downloaded ? (
              <Pressable
                onPress={() => deleteDownloadedMap(item)}
                className="rounded-full bg-red-50 p-2 active:bg-red-100">
                <Icon as={Trash2Icon} size={20} className="text-red-500" />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => downloadMap(item)}
                className="rounded-full bg-[#7bed9a]/20 p-2 active:bg-[#7bed9a]/30">
                <Icon as={DownloadIcon} size={20} className="text-[#7bed9a]" />
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="flex-row items-center justify-between bg-white px-4 py-3 shadow-sm">
        <Text className="text-xl font-bold text-gray-900">Maps</Text>
        <Pressable
          onPress={handleRefresh}
          disabled={isLoading || isRefetching}
          className="rounded-full bg-gray-100 p-2 active:bg-gray-200">
          <Icon
            as={RefreshCwIcon}
            size={20}
            className={cn('text-gray-600', (isLoading || isRefetching) && 'animate-spin')}
          />
        </Pressable>
      </View>

      {/* Content */}
      <FlatList
        data={localMaps}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMapItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            colors={['#7bed9a']}
            tintColor="#7bed9a"
          />
        }
        ListHeaderComponent={
          <View className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <View className="flex-row items-start">
              <Icon as={CloudDownloadIcon} size={20} className="mt-0.5 text-blue-500" />
              <View className="ml-3 flex-1">
                <Text className="text-sm font-medium text-blue-800">Offline Maps</Text>
                <Text className="mt-1 text-xs text-blue-600">
                  Download maps to use them offline. Tap on a downloaded map to view it with your
                  current location.
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#7bed9a" size="large" />
              <Text className="mt-4 text-gray-500">Loading maps...</Text>
            </View>
          ) : (
            <View className="items-center py-12">
              <View className="h-24 w-24 items-center justify-center rounded-full bg-gray-100">
                <Icon as={MapIcon} size={48} className="text-gray-300" />
              </View>
              <Text className="mt-4 text-lg font-semibold text-gray-700">No Maps Available</Text>
              <Text className="mt-1 text-center text-gray-500">
                Pull down to refresh and check for available maps.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
