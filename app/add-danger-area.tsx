import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth-context';
import { insertLocalDangerousArea } from '@/lib/database';
import { cn } from '@/lib/utils';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  MapPinIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type RiskLevel = 'low' | 'medium' | 'high';

interface FormData {
  name: string;
  latitude: string;
  longitude: string;
  photo: string;
  risk: RiskLevel;
}

export default function AddDangerAreaScreen() {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = React.useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const cameraRef = React.useRef<CameraView>(null);

  const [formData, setFormData] = React.useState<FormData>({
    name: '',
    latitude: '',
    longitude: '',
    photo: '',
    risk: 'medium',
  });

  const [errors, setErrors] = React.useState<Partial<FormData>>({});

  // Request location on mount
  React.useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Location permission is required to capture danger areas.'
        );
        setIsLoadingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setFormData((prev) => ({
        ...prev,
        latitude: location.coords.latitude.toFixed(8),
        longitude: location.coords.longitude.toFixed(8),
      }));
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get current location. Please try again.');
    }
    setIsLoadingLocation(false);
  };

  const handleOpenCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
        return;
      }
    }
    setShowCamera(true);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });

      if (photo?.uri) {
        setFormData((prev) => ({ ...prev, photo: photo.uri }));
        setShowCamera(false);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const handleRemovePhoto = () => {
    setFormData((prev) => ({ ...prev, photo: '' }));
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.length > 255) {
      newErrors.name = 'Name must be less than 255 characters';
    }

    if (!formData.latitude) {
      newErrors.latitude = 'Latitude is required';
    } else {
      const lat = parseFloat(formData.latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        newErrors.latitude = 'Invalid latitude (-90 to 90)';
      }
    }

    if (!formData.longitude) {
      newErrors.longitude = 'Longitude is required';
    } else {
      const lng = parseFloat(formData.longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        newErrors.longitude = 'Invalid longitude (-180 to 180)';
      }
    }

    if (!formData.photo) {
      newErrors.photo = 'Photo is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fill in all required fields correctly.');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setIsSaving(true);
    try {
      // Save to local database
      insertLocalDangerousArea({
        user_uid: user.uid,
        area_id: 1, // Default area_id as specified
        name: formData.name.trim(),
        latitude: formData.latitude,
        longitude: formData.longitude,
        photo: formData.photo,
        risk: formData.risk,
        created_at: new Date().toISOString(),
        user: {
          uid: user.uid,
          name: user.name,
          username: user.username,
          phone: '',
          email: user.email,
          level: user.level,
        },
      });

      Alert.alert('Success', 'Danger area saved locally. Sync to upload to server.', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      console.error('Error saving danger area:', error);
      Alert.alert('Error', 'Failed to save danger area. Please try again.');
    }
    setIsSaving(false);
  };

  const riskLevels: { value: RiskLevel; label: string; color: string; bgColor: string }[] = [
    { value: 'low', label: 'Low', color: 'text-green-600', bgColor: 'bg-green-100' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
    { value: 'high', label: 'High', color: 'text-red-600', bgColor: 'bg-red-100' },
  ];

  // Camera view
  if (showCamera) {
    return (
      <View className="flex-1 bg-black">
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
          <SafeAreaView className="flex-1">
            {/* Camera header */}
            <View className="flex-row items-center justify-between px-4 py-2">
              <Pressable
                onPress={() => setShowCamera(false)}
                className="h-10 w-10 items-center justify-center rounded-full bg-black/50">
                <Icon as={XIcon} size={24} className="text-white" />
              </Pressable>
              <Text className="text-lg font-semibold text-white">Take Photo</Text>
              <View className="h-10 w-10" />
            </View>

            {/* Camera footer */}
            <View className="mt-auto items-center pb-8">
              <Pressable
                onPress={handleTakePhoto}
                className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/30">
                <View className="h-16 w-16 rounded-full bg-white" />
              </Pressable>
            </View>
          </SafeAreaView>
        </CameraView>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="flex-row items-center bg-white px-4 py-3 shadow-sm">
        <Pressable onPress={() => router.back()} className="mr-3 p-1">
          <Icon as={ChevronLeftIcon} size={24} className="text-gray-700" />
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-gray-900">Add Danger Area</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1">
        <ScrollView className="flex-1 p-4" showsVerticalScrollIndicator={false}>
          {/* Photo Section */}
          <View className="mb-6">
            <Text className="mb-2 text-sm font-medium text-gray-700">
              Photo <Text className="text-red-500">*</Text>
            </Text>
            {formData.photo ? (
              <View className="relative">
                <Image
                  source={{ uri: formData.photo }}
                  className="h-48 w-full rounded-xl"
                  resizeMode="cover"
                />
                <Pressable
                  onPress={handleRemovePhoto}
                  className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-red-500">
                  <Icon as={XIcon} size={18} className="text-white" />
                </Pressable>
                <Pressable
                  onPress={handleOpenCamera}
                  className="absolute bottom-2 right-2 flex-row items-center rounded-full bg-black/60 px-3 py-2">
                  <Icon as={CameraIcon} size={16} className="mr-1 text-white" />
                  <Text className="text-sm text-white">Retake</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={handleOpenCamera}
                className={cn(
                  'h-48 items-center justify-center rounded-xl border-2 border-dashed',
                  errors.photo ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                )}>
                <View className="h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <Icon as={CameraIcon} size={32} className="text-gray-400" />
                </View>
                <Text className="mt-3 text-sm font-medium text-gray-600">Tap to take photo</Text>
                <Text className="mt-1 text-xs text-gray-400">Max 5MB</Text>
              </Pressable>
            )}
            {errors.photo && <Text className="mt-1 text-xs text-red-500">{errors.photo}</Text>}
          </View>

          {/* Name Input */}
          <View className="mb-4">
            <Text className="mb-2 text-sm font-medium text-gray-700">
              Name <Text className="text-red-500">*</Text>
            </Text>
            <TextInput
              value={formData.name}
              onChangeText={(text) => setFormData((prev) => ({ ...prev, name: text }))}
              placeholder="Enter danger area name"
              className={cn(
                'rounded-xl border bg-white px-4 py-3 text-base text-gray-900',
                errors.name ? 'border-red-400' : 'border-gray-200'
              )}
              maxLength={255}
            />
            {errors.name && <Text className="mt-1 text-xs text-red-500">{errors.name}</Text>}
          </View>

          {/* Location Section */}
          <View className="mb-4">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-sm font-medium text-gray-700">
                Location <Text className="text-red-500">*</Text>
              </Text>
              <Pressable
                onPress={getCurrentLocation}
                disabled={isLoadingLocation}
                className="flex-row items-center">
                {isLoadingLocation ? (
                  <ActivityIndicator size="small" color="#7bed9a" />
                ) : (
                  <>
                    <Icon as={RefreshCwIcon} size={14} className="mr-1 text-[#7bed9a]" />
                    <Text className="text-sm font-medium text-[#7bed9a]">Refresh</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View className="flex-row gap-3">
              {/* Latitude */}
              <View className="flex-1">
                <Text className="mb-1 text-xs text-gray-500">Latitude</Text>
                <View
                  className={cn(
                    'flex-row items-center rounded-xl border bg-white px-3 py-2.5',
                    errors.latitude ? 'border-red-400' : 'border-gray-200'
                  )}>
                  <Icon as={MapPinIcon} size={16} className="mr-2 text-gray-400" />
                  <TextInput
                    value={formData.latitude}
                    onChangeText={(text) => setFormData((prev) => ({ ...prev, latitude: text }))}
                    placeholder="0.00000000"
                    keyboardType="numeric"
                    className="flex-1 text-sm text-gray-900"
                  />
                </View>
                {errors.latitude && (
                  <Text className="mt-1 text-xs text-red-500">{errors.latitude}</Text>
                )}
              </View>

              {/* Longitude */}
              <View className="flex-1">
                <Text className="mb-1 text-xs text-gray-500">Longitude</Text>
                <View
                  className={cn(
                    'flex-row items-center rounded-xl border bg-white px-3 py-2.5',
                    errors.longitude ? 'border-red-400' : 'border-gray-200'
                  )}>
                  <Icon as={MapPinIcon} size={16} className="mr-2 text-gray-400" />
                  <TextInput
                    value={formData.longitude}
                    onChangeText={(text) => setFormData((prev) => ({ ...prev, longitude: text }))}
                    placeholder="0.00000000"
                    keyboardType="numeric"
                    className="flex-1 text-sm text-gray-900"
                  />
                </View>
                {errors.longitude && (
                  <Text className="mt-1 text-xs text-red-500">{errors.longitude}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Risk Level */}
          <View className="mb-6">
            <Text className="mb-2 text-sm font-medium text-gray-700">
              Risk Level <Text className="text-red-500">*</Text>
            </Text>
            <View className="flex-row gap-2">
              {riskLevels.map((level) => (
                <Pressable
                  key={level.value}
                  onPress={() => setFormData((prev) => ({ ...prev, risk: level.value }))}
                  className={cn(
                    'flex-1 items-center rounded-xl border-2 py-3',
                    formData.risk === level.value
                      ? `${level.bgColor} border-current`
                      : 'border-gray-200 bg-white'
                  )}
                  style={{
                    borderColor:
                      formData.risk === level.value
                        ? level.value === 'low'
                          ? '#16a34a'
                          : level.value === 'medium'
                            ? '#ca8a04'
                            : '#dc2626'
                        : '#e5e7eb',
                  }}>
                  <View
                    className={cn(
                      'mb-1 h-6 w-6 items-center justify-center rounded-full',
                      formData.risk === level.value ? level.bgColor : 'bg-gray-100'
                    )}>
                    {formData.risk === level.value && (
                      <Icon
                        as={CheckIcon}
                        size={14}
                        color={
                          level.value === 'low'
                            ? '#16a34a'
                            : level.value === 'medium'
                              ? '#ca8a04'
                              : '#dc2626'
                        }
                      />
                    )}
                  </View>
                  <Text
                    className={cn(
                      'text-sm font-medium',
                      formData.risk === level.value ? level.color : 'text-gray-500'
                    )}>
                    {level.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Info Card */}
          <View className="mb-6 flex-row rounded-xl bg-blue-50 p-4">
            <Icon as={AlertTriangleIcon} size={20} className="mr-3 text-blue-500" />
            <View className="flex-1">
              <Text className="text-sm font-medium text-blue-800">Offline Support</Text>
              <Text className="mt-1 text-xs text-blue-600">
                Data will be saved locally. Use "Upload to Server" button on the Danger Area list to
                sync with the server.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Save Button */}
        <View className="border-t border-gray-200 bg-white p-4">
          <Button
            onPress={handleSave}
            disabled={isSaving}
            className="h-12 w-full rounded-xl bg-[#7bed9a]">
            {isSaving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text className="text-base font-semibold text-gray-900">Save Danger Area</Text>
            )}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
