import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { getMapImageById, MapImage } from '@/lib/database';
import { cn } from '@/lib/utils';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import {
  ArrowLeftIcon,
  CrosshairIcon,
  LocateIcon,
  MinusIcon,
  NavigationIcon,
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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Constants for zoom limits
const MIN_SCALE = 0.5;
const MAX_SCALE = 10;

export default function MapViewerScreen() {
  const { mapId } = useLocalSearchParams<{ mapId: string }>();

  const [mapImage, setMapImage] = React.useState<MapImage | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [userLocation, setUserLocation] = React.useState<Location.LocationObject | null>(null);
  const [isLocating, setIsLocating] = React.useState(false);
  const [isWithinBounds, setIsWithinBounds] = React.useState(false);

  // Animated values for pan and zoom
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Load map image data
  React.useEffect(() => {
    const loadMap = async () => {
      if (!mapId) {
        setIsLoading(false);
        return;
      }

      try {
        const map = getMapImageById(parseInt(mapId, 10));
        if (map && map.local_image_path) {
          setMapImage(map);

          // Get image dimensions
          const imageUri = map.local_image_path.startsWith('file://')
            ? map.local_image_path
            : `file://${map.local_image_path}`;

          Image.getSize(
            imageUri,
            (width, height) => {
              setImageSize({ width, height });
              setIsLoading(false);
            },
            (error) => {
              console.error('Error getting image size:', error);
              Alert.alert('Error', 'Failed to load map image', [
                { text: 'OK', onPress: () => router.back() },
              ]);
              setIsLoading(false);
            }
          );
        } else {
          Alert.alert('Error', 'Map not found or not downloaded', [
            { text: 'OK', onPress: () => router.back() },
          ]);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error loading map:', error);
        Alert.alert('Error', 'Failed to load map data');
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
            timeInterval: 3000,
            distanceInterval: 2,
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

  // Calculate user position on the image (pixel coordinates)
  const getUserPositionOnImage = React.useCallback(() => {
    if (!mapImage || !userLocation || imageSize.width === 0) return null;

    const bottomLeft = {
      lat: parseFloat(mapImage.bottom_left_latitude),
      lng: parseFloat(mapImage.bottom_left_longitude),
    };
    const topRight = {
      lat: parseFloat(mapImage.top_right_latitude),
      lng: parseFloat(mapImage.top_right_longitude),
    };

    const userLat = userLocation.coords.latitude;
    const userLng = userLocation.coords.longitude;

    // Check if user is within bounds
    const withinLat = userLat >= bottomLeft.lat && userLat <= topRight.lat;
    const withinLng = userLng >= bottomLeft.lng && userLng <= topRight.lng;

    // Calculate position as percentage
    const xPercent = (userLng - bottomLeft.lng) / (topRight.lng - bottomLeft.lng);
    const yPercent = (topRight.lat - userLat) / (topRight.lat - bottomLeft.lat);

    // Convert to pixel coordinates on the displayed image
    const x = xPercent * imageSize.width;
    const y = yPercent * imageSize.height;

    return {
      x,
      y,
      withinBounds: withinLat && withinLng,
    };
  }, [mapImage, userLocation, imageSize]);

  // Update isWithinBounds state
  React.useEffect(() => {
    const pos = getUserPositionOnImage();
    setIsWithinBounds(pos?.withinBounds ?? false);
  }, [getUserPositionOnImage]);

  // Calculate the display dimensions to fit screen while maintaining aspect ratio
  const getDisplayDimensions = () => {
    if (imageSize.width === 0 || imageSize.height === 0) {
      return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
    }

    const imageAspect = imageSize.width / imageSize.height;
    const screenAspect = SCREEN_WIDTH / SCREEN_HEIGHT;

    if (imageAspect > screenAspect) {
      // Image is wider than screen
      return {
        width: SCREEN_WIDTH,
        height: SCREEN_WIDTH / imageAspect,
      };
    } else {
      // Image is taller than screen
      return {
        width: SCREEN_HEIGHT * imageAspect,
        height: SCREEN_HEIGHT,
      };
    }
  };

  const displayDimensions = getDisplayDimensions();

  // Pan gesture
  const panGesture = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      // Clamp translation to bounds
      const maxTranslateX = (displayDimensions.width * scale.value - SCREEN_WIDTH) / 2;
      const maxTranslateY = (displayDimensions.height * scale.value - SCREEN_HEIGHT) / 2;

      if (scale.value <= 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      } else {
        translateX.value = withSpring(
          Math.max(-maxTranslateX, Math.min(maxTranslateX, translateX.value))
        );
        translateY.value = withSpring(
          Math.max(-maxTranslateY, Math.min(maxTranslateY, translateY.value))
        );
      }
    });

  // Pinch gesture for zoom
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });

  // Double tap to zoom
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((event) => {
      if (scale.value > 1) {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      } else {
        scale.value = withSpring(3);
        // Center zoom on tap point
        const centerX = SCREEN_WIDTH / 2;
        const centerY = SCREEN_HEIGHT / 2;
        translateX.value = withSpring((centerX - event.x) * 2);
        translateY.value = withSpring((centerY - event.y) * 2);
      }
    });

  // Combine gestures
  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture, doubleTapGesture);

  // Animated style for the image container
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Zoom in
  const zoomIn = () => {
    scale.value = withTiming(Math.min(MAX_SCALE, scale.value * 1.5), { duration: 300 });
  };

  // Zoom out
  const zoomOut = () => {
    const newScale = scale.value / 1.5;
    scale.value = withTiming(Math.max(MIN_SCALE, newScale), { duration: 300 });
    if (newScale < 1) {
      translateX.value = withTiming(0, { duration: 300 });
      translateY.value = withTiming(0, { duration: 300 });
    }
  };

  // Reset view
  const resetView = () => {
    scale.value = withSpring(1);
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
  };

  // Center on user location
  const centerOnUser = async () => {
    const pos = getUserPositionOnImage();
    if (!pos) {
      setIsLocating(true);
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setUserLocation(location);
      } catch (error) {
        Alert.alert('Error', 'Unable to get your current location.');
      } finally {
        setIsLocating(false);
      }
      return;
    }

    if (!pos.withinBounds) {
      Alert.alert('Outside Map', 'Your current location is outside the map boundaries.');
      return;
    }

    // Center the view on user position
    const scaleFactorX = displayDimensions.width / imageSize.width;
    const scaleFactorY = displayDimensions.height / imageSize.height;

    const userDisplayX = pos.x * scaleFactorX;
    const userDisplayY = pos.y * scaleFactorY;

    // Center offset from image center
    const imageCenterX = displayDimensions.width / 2;
    const imageCenterY = displayDimensions.height / 2;

    const offsetX = imageCenterX - userDisplayX;
    const offsetY = imageCenterY - userDisplayY;

    scale.value = withSpring(3);
    translateX.value = withSpring(offsetX * 3);
    translateY.value = withSpring(offsetY * 3);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-900">
        <ActivityIndicator color="#7bed9a" size="large" />
        <Text className="mt-4 text-white">Loading map...</Text>
      </View>
    );
  }

  if (!mapImage || !mapImage.local_image_path) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-900">
        <Text className="text-white">Map not found</Text>
      </View>
    );
  }

  const imageUri = mapImage.local_image_path.startsWith('file://')
    ? mapImage.local_image_path
    : `file://${mapImage.local_image_path}`;

  const userPos = getUserPositionOnImage();

  // Calculate user marker position on screen
  const getUserMarkerPosition = () => {
    if (!userPos || imageSize.width === 0) return null;

    const scaleFactorX = displayDimensions.width / imageSize.width;
    const scaleFactorY = displayDimensions.height / imageSize.height;

    return {
      x: userPos.x * scaleFactorX,
      y: userPos.y * scaleFactorY,
      withinBounds: userPos.withinBounds,
    };
  };

  const markerPos = getUserMarkerPosition();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-gray-900">
        <StatusBar barStyle="light-content" />

        {/* Map Image with Pan/Zoom */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[
              {
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
              },
              animatedStyle,
            ]}>
            {/* Map Image */}
            <Image
              source={{ uri: imageUri }}
              style={{
                width: displayDimensions.width,
                height: displayDimensions.height,
              }}
              resizeMode="contain"
            />

            {/* User Location Marker */}
            {markerPos && markerPos.withinBounds && (
              <View
                style={{
                  position: 'absolute',
                  left: (SCREEN_WIDTH - displayDimensions.width) / 2 + markerPos.x - 16,
                  top: (SCREEN_HEIGHT - displayDimensions.height) / 2 + markerPos.y - 16,
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {/* Outer pulse ring */}
                <View
                  style={{
                    position: 'absolute',
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                  }}
                />
                {/* Inner dot */}
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: '#3b82f6',
                    borderWidth: 3,
                    borderColor: 'white',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 4,
                    elevation: 5,
                  }}
                />
                {/* Direction arrow (if heading available) */}
                {userLocation?.coords.heading !== undefined && userLocation.coords.heading >= 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -8,
                      transform: [{ rotate: `${userLocation.coords.heading}deg` }],
                    }}>
                    <Icon as={NavigationIcon} size={14} className="text-blue-500" />
                  </View>
                )}
              </View>
            )}
          </Animated.View>
        </GestureDetector>

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
          {/* Reset view */}
          <Pressable
            onPress={resetView}
            className="h-12 w-12 items-center justify-center rounded-full bg-white shadow-lg">
            <Icon as={CrosshairIcon} size={22} className="text-gray-700" />
          </Pressable>

          {/* Center on user */}
          <Pressable
            onPress={centerOnUser}
            disabled={isLocating}
            className={cn(
              'h-12 w-12 items-center justify-center rounded-full shadow-lg',
              isWithinBounds ? 'bg-white' : 'bg-gray-300'
            )}>
            {isLocating ? (
              <ActivityIndicator color="#7bed9a" size="small" />
            ) : (
              <Icon
                as={LocateIcon}
                size={22}
                className={isWithinBounds ? 'text-[#7bed9a]' : 'text-gray-500'}
              />
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
        <View className="absolute bottom-8 left-4 rounded-xl bg-black/70 px-4 py-2">
          {userLocation ? (
            <>
              <Text className="text-xs text-white/70">Your Location</Text>
              <Text className="text-sm font-medium text-white">
                {userLocation.coords.latitude.toFixed(6)},{' '}
                {userLocation.coords.longitude.toFixed(6)}
              </Text>
              {!isWithinBounds && (
                <Text className="mt-1 text-xs text-yellow-400">Outside map area</Text>
              )}
            </>
          ) : (
            <Text className="text-xs text-white/70">Getting location...</Text>
          )}
        </View>

        {/* Accuracy indicator */}
        {userLocation?.coords.accuracy && (
          <View className="absolute bottom-24 left-4 rounded-lg bg-black/50 px-3 py-1">
            <Text className="text-xs text-white/70">
              Accuracy: ±{Math.round(userLocation.coords.accuracy)}m
            </Text>
          </View>
        )}
      </View>
    </GestureHandlerRootView>
  );
}
