import type { ImageSourcePropType } from 'react-native';

// Android header menus render only image sources (SF Symbols are iOS-only).
// Material vector drawables, bundled as assets.
export const accountIcon = require('../../../assets/account_circle.xml') as ImageSourcePropType;
export const addIcon = require('../../../assets/add.xml') as ImageSourcePropType;
export const backIcon = require('../../../assets/arrow_back.xml') as ImageSourcePropType;
