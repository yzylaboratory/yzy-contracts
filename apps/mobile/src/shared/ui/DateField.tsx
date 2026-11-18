import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { formatDateEs, isValidIsoDate } from '../format/date';
import { colors, fonts, radius, space, touch } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date at local midnight — no UTC shift from zone offsets. */
export function isoDateToLocalDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day);
}

export function localDateToIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  allowEmpty?: boolean;
};

function displayValue(value: string, allowEmpty: boolean): string {
  if (value === '' && allowEmpty) return 'Sin fecha';
  if (isValidIsoDate(value)) return formatDateEs(value);
  if (value === '') return 'Elegir fecha';
  return value;
}

export function DateField({ label, value, onChange, error, hint, allowEmpty = false }: Props) {
  const [iosOpen, setIosOpen] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  const [draft, setDraft] = useState(() => isoDateToLocalDate(value) ?? new Date());

  const pickerDate = useMemo(() => isoDateToLocalDate(value) ?? new Date(), [value]);

  const openPicker = () => {
    setDraft(pickerDate);
    if (Platform.OS === 'ios') setIosOpen(true);
    else setAndroidOpen(true);
  };

  const commitIos = () => {
    onChange(localDateToIsoDate(draft));
    setIosOpen(false);
  };

  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setAndroidOpen(false);
    if (event.type !== 'set' || !selected) return;
    onChange(localDateToIsoDate(selected));
  };

  const describedText = error ?? hint;
  const shown = displayValue(value, allowEmpty);
  const emptyPlaceholder = value === '' || !isValidIsoDate(value);

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" tone="secondary">
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={describedText ?? 'Abre el selector de fecha'}
        accessibilityState={{ expanded: iosOpen || androidOpen }}
        onPress={openPicker}
        style={[styles.field, error ? styles.fieldError : null]}
      >
        <AppText variant="body" style={emptyPlaceholder ? styles.placeholder : undefined}>
          {shown}
        </AppText>
      </Pressable>
      {describedText ? (
        <AppText variant="caption" tone={error ? 'danger' : 'muted'} accessibilityLiveRegion="polite">
          {describedText}
        </AppText>
      ) : null}

      {Platform.OS === 'android' && androidOpen ? (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          accentColor={colors.green}
          onChange={onAndroidChange}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
          <View style={styles.backdrop}>
            <View style={styles.sheet} accessibilityViewIsModal>
              <AppText variant="title">{label}</AppText>
              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                themeVariant="light"
                onChange={(_, selected) => {
                  if (selected) setDraft(selected);
                }}
                style={styles.picker}
              />
              <Button label="Listo" onPress={commitIos} />
              {allowEmpty ? (
                <Button
                  label="Quitar fecha"
                  variant="ghost"
                  onPress={() => {
                    onChange('');
                    setIosOpen(false);
                  }}
                />
              ) : null}
              <Button label="Cancelar" variant="secondary" onPress={() => setIosOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  field: {
    minHeight: touch.button,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  fieldError: { borderColor: colors.danger, borderWidth: 2 },
  placeholder: { color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(27,31,87,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  picker: { alignSelf: 'center' },
});