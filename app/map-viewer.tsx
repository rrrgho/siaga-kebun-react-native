import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { getMapImageById, MapImage } from '@/lib/database';
import { cn } from '@/lib/utils';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import {
  ArrowLeftIcon,
  CrosshairIcon,
  LayersIcon,
  LocateIcon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Platform,
  Pressable,
  StatusBar,
  View,
} from 'react-native';
import MapView, { Overlay, PROVIDER_DEFAULT, Region } from 'react-native-maps';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function MapViewerScreen() {
  const { mapId } = useLocalSearchParams<{ mapId: string }>();
  const mapRef = React.useRef<MapView>(null);

  const [mapImage, setMapImage] = React.useState<MapImage | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [imageExists, setImageExists] = React.useState(false);
  const [userLocation, setUserLocation] = React.useState<Location.LocationObject | null>(null);
  const [isLocating, setIsLocating] = React.useState(false);
  const [showOverlay, setShowOverlay] = React.useState(true);
  const [mapType, setMapType] = React.useState<'standard' | 'satellite' | 'hybrid'>('standard');

  // Load map image data and verify file exists
  React.useEffect(() => {
    const loadMap = async () => {
      if (!mapId) {
        setIsLoading(false);
        return;
      }

      try {
        const map = getMapImageById(parseInt(mapId, 10));
        if (map) {
          setMapImage(map);
          console.log('Map loaded:', map.name, 'Local path:', map.local_image_path);

          // Verify the local image file exists
          // We assume the file exists if we have a path - the Overlay component handles missing files gracefully
          if (map.local_image_path) {
            setImageExists(true);
            console.log('Map image path set:', map.local_image_path);
          }
        } else {
          Alert.alert('Error', 'Map not found', [{ text: 'OK', onPress: () => router.back() }]);
        }
      } catch (error) {
        console.error('Error loading map:', error);
        Alert.alert('Error', 'Failed to load map data');
      } finally {
        setIsLoading(false);
      }
    };

    loadMap();
  }, [mapId]);

  // Request location permission and get initial location
  React.useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Location Permission',
            'Please enable location permission to see your position on the map.'
          );
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setUserLocation(location);
      } catch (error) {
        console.error('Error getting location:', error);
      }
    };

    getLocation();
  }, []);

  // Subscribe to location updates
  React.useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    const startLocationUpdates = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (location) => {
            setUserLocation(location);
          }
        );
      } catch (error) {
        console.error('Error starting location updates:', error);
      }
    };

    startLocationUpdates();

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, []);

  // Calculate initial region based on map bounds
  const getInitialRegion = (): Region | undefined => {
    if (!mapImage) return undefined;

    const bottomLeft = {
      latitude: parseFloat(mapImage.bottom_left_latitude),
      longitude: parseFloat(mapImage.bottom_left_longitude),
    };
    const topRight = {
      latitude: parseFloat(mapImage.top_right_latitude),
      longitude: parseFloat(mapImage.top_right_longitude),
    };

    const centerLatitude = (bottomLeft.latitude + topRight.latitude) / 2;
    const centerLongitude = (bottomLeft.longitude + topRight.longitude) / 2;
    const latitudeDelta = Math.abs(topRight.latitude - bottomLeft.latitude) * 1.2;
    const longitudeDelta = Math.abs(topRight.longitude - bottomLeft.longitude) * 1.2;

    return {
      latitude: centerLatitude,
      longitude: centerLongitude,
      latitudeDelta,
      longitudeDelta,
    };
  };

  // Get overlay bounds for the custom map image
  const getOverlayBounds = (): [[number, number], [number, number]] | undefined => {
    if (!mapImage) return undefined;

    // Overlay bounds: [[southwestLat, southwestLng], [northeastLat, northeastLng]]
    return [
      [parseFloat(mapImage.bottom_left_latitude), parseFloat(mapImage.bottom_left_longitude)],
      [parseFloat(mapImage.top_right_latitude), parseFloat(mapImage.top_right_longitude)],
    ];
  };

  // Center map on user location
  const centerOnUser = async () => {
    if (!userLocation || !mapRef.current) {
      setIsLocating(true);
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setUserLocation(location);
        mapRef.current?.animateToRegion(
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          },
          500
        );
      } catch (error) {
        Alert.alert('Error', 'Unable to get your current location.');
      } finally {
        setIsLocating(false);
      }
      return;
    }

    mapRef.current.animateToRegion(
      {
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      500
    );
  };

  // Fit map to show the entire overlay
  const fitToOverlay = () => {
    const region = getInitialRegion();
    if (region && mapRef.current) {
      mapRef.current.animateToRegion(region, 500);
    }
  };

  // Zoom in
  const zoomIn = () => {
    mapRef.current?.getCamera().then((camera) => {
      if (camera.zoom !== undefined) {
        mapRef.current?.animateCamera({ zoom: camera.zoom + 1 }, { duration: 300 });
      } else {
        // For iOS
        mapRef.current?.getMapBoundaries().then(() => {
          const region = getInitialRegion();
          if (region) {
            mapRef.current?.animateToRegion(
              {
                ...region,
                latitudeDelta: region.latitudeDelta * 0.5,
                longitudeDelta: region.longitudeDelta * 0.5,
              },
              300
            );
          }
        });
      }
    });
  };

  // Zoom out
  const zoomOut = () => {
    mapRef.current?.getCamera().then((camera) => {
      if (camera.zoom !== undefined) {
        mapRef.current?.animateCamera({ zoom: camera.zoom - 1 }, { duration: 300 });
      } else {
        const region = getInitialRegion();
        if (region) {
          mapRef.current?.animateToRegion(
            {
              ...region,
              latitudeDelta: region.latitudeDelta * 2,
              longitudeDelta: region.longitudeDelta * 2,
            },
            300
          );
        }
      }
    });
  };

  // Toggle map type
  const cycleMapType = () => {
    setMapType((current) => {
      switch (current) {
        case 'standard':
          return 'satellite';
        case 'satellite':
          return 'hybrid';
        case 'hybrid':
          return 'standard';
      }
    });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-900">
        <ActivityIndicator color="#7bed9a" size="large" />
        <Text className="mt-4 text-white">Loading map...</Text>
      </View>
    );
  }

  if (!mapImage) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-900">
        <Text className="text-white">Map not found</Text>
      </View>
    );
  }

  const initialRegion = getInitialRegion();
  const overlayBounds = getOverlayBounds();

  return (
    <View className="flex-1 bg-gray-900">
      <StatusBar barStyle="light-content" />

      {/* Map */}
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        mapType={mapType}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        rotateEnabled={true}
        pitchEnabled={false}>
        {/* Custom map overlay */}
        {showOverlay && overlayBounds && mapImage.local_image_path && imageExists && (
          <Overlay
            bounds={overlayBounds}
            image={{
              uri: mapImage.local_image_path.startsWith('file://')
                ? mapImage.local_image_path
                : `file://${mapImage.local_image_path}`,
            }}
            opacity={0.9}
          />
        )}
      </MapView>

      {/* Header */}
      <View
        className="absolute left-0 right-0 top-0"
        style={{ paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight || 10 }}>
        <View className="mx-4 flex-row items-center rounded-xl bg-black/70 p-3">
          <Pressable
            onPress={() => router.back()}
            className="rounded-full bg-white/20 p-2 active:bg-white/30">
            <Icon as={ArrowLeftIcon} size={24} className="text-white" />
          </Pressable>
          <View className="ml-3 flex-1">
            <Text className="text-lg font-bold text-white" numberOfLines={1}>
              {mapImage.name}
            </Text>
            {mapImage.description && (
              <Text className="text-xs text-white/70" numberOfLines={1}>
                {mapImage.description}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Map controls */}
      <View className="absolute bottom-8 right-4 gap-2">
        {/* Toggle overlay */}
        <Pressable
          onPress={() => setShowOverlay(!showOverlay)}
          className={cn(
            'h-12 w-12 items-center justify-center rounded-full shadow-lg',
            showOverlay ? 'bg-[#7bed9a]' : 'bg-white'
          )}>
          <Icon
            as={LayersIcon}
            size={22}
            className={showOverlay ? 'text-white' : 'text-gray-700'}
          />
        </Pressable>

        {/* Map type */}
        <Pressable
          onPress={cycleMapType}
          className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
          <Text className="text-xs font-semibold text-gray-700">
            {mapType === 'standard' ? 'MAP' : mapType === 'satellite' ? 'SAT' : 'HYB'}
          </Text>
        </Pressable>

        {/* Fit to overlay */}
        <Pressable
          onPress={fitToOverlay}
          className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
          <Icon as={CrosshairIcon} size={22} className="text-gray-700" />
        </Pressable>

        {/* Center on user */}
        <Pressable
          onPress={centerOnUser}
          disabled={isLocating}
          className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
          {isLocating ? (
            <ActivityIndicator color="#7bed9a" size="small" />
          ) : (
            <Icon as={LocateIcon} size={22} className="text-[#7bed9a]" />
          )}
        </Pressable>

        {/* Zoom controls */}
        <Pressable
          onPress={zoomIn}
          className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
          <Icon as={PlusIcon} size={22} className="text-gray-700" />
        </Pressable>

        <Pressable
          onPress={zoomOut}
          className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
          <Icon as={MinusIcon} size={22} className="text-gray-700" />
        </Pressable>
      </View>

      {/* Location info */}
      {userLocation && (
        <View className="absolute bottom-8 left-4 rounded-xl bg-black/70 px-4 py-2">
          <Text className="text-xs text-white/70">Your Location</Text>
          <Text className="text-sm font-medium text-white">
            {userLocation.coords.latitude.toFixed(6)}, {userLocation.coords.longitude.toFixed(6)}
          </Text>
        </View>
      )}
    </View>
  );
}
