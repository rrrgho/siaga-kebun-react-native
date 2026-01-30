import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MapIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MapScreen() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-white px-4 py-3 shadow-sm">
        <Text className="text-xl font-bold text-gray-900">Map</Text>
      </View>

      {/* Content */}
      <View className="flex-1 items-center justify-center p-6">
        <View className="items-center rounded-2xl bg-white p-8 shadow-sm">
          <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-[#7bed9a]/20">
            <Icon as={MapIcon} size={48} className="text-[#7bed9a]" />
          </View>
          <Text className="text-xl font-semibold text-gray-800">Map View</Text>
          <Text className="mt-2 text-center text-gray-500">
            Map feature coming soon.{'\n'}We will display tracked locations here.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
