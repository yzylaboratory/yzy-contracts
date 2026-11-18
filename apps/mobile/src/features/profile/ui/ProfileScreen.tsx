import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { readSupabaseAccountName, useProfileStore } from '../../../lib/account-profile';
import { AppText } from '../../../shared/ui/AppText';
import { Avatar } from '../../../shared/ui/Avatar';
import { Button } from '../../../shared/ui/Button';
import { Screen } from '../../../shared/ui/Screen';
import { TextField } from '../../../shared/ui/TextField';
import { space } from '../../../shared/theme/tokens';
import { useGate } from '../../access';
import { AccountChrome } from '../../shell/AccountChrome';

export function ProfileScreen() {
  const { me } = useGate();
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const setProfileName = useProfileStore((state) => state.setName);

  useEffect(() => {
    if (!me) return;
    let active = true;
    void readSupabaseAccountName(me.id, me.email).then((saved) => {
      if (active) {
        setName(saved);
        setDraft(null);
      }
    });
    return () => {
      active = false;
    };
  }, [me]);

  if (!me) return null;

  const currentName = draft ?? name;

  const cancel = () => {
    setDraft(null);
    setNameError('');
    setSaveError('');
    setNotice('Se restauró el nombre guardado.');
  };

  const save = async () => {
    const clean = currentName.trim();
    setNameError('');
    setSaveError('');
    setNotice('');
    if (!clean) {
      setNameError('Escribe un nombre para el perfil.');
      return;
    }
    setProfileName(me.id, clean);
    setName(clean);
    setDraft(null);
    setNotice('Perfil guardado para esta sesión.');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Perfil' }} />
      <AccountChrome />
      <Screen>
        <AppText tone="secondary">Consulta los datos de tu cuenta y edita tu nombre.</AppText>
        <View style={styles.panel}>
          <AppText variant="subheading">Datos del perfil</AppText>
          <Avatar name={currentName || me.email || '?'} size={72} />
          <TextField
            label="Nombre"
            placeholder="Nombre completo…"
            value={currentName}
            error={nameError}
            onChangeText={(value) => {
              setDraft(value.length > 100 ? value.slice(0, 100) : value);
              setNameError('');
              setSaveError('');
              setNotice('');
            }}
          />
          <TextField
            label="Correo electrónico"
            value={me.email ?? ''}
            editable={false}
            onChangeText={() => undefined}
          />
          <AppText variant="caption" tone="secondary">
            Los cambios de nombre se guardan en esta sesión de la app.
          </AppText>
          {notice ? <AppText variant="caption" tone="secondary">{notice}</AppText> : null}
          {saveError ? (
            <AppText variant="caption" tone="danger" accessibilityRole="alert">
              {saveError}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <Button label="Cancelar" variant="secondary" onPress={cancel} />
            <Button label="Guardar cambios" onPress={() => void save()} />
          </View>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  actions: { gap: space.sm },
});