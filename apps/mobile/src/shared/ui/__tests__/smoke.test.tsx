import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('renders a text node', async () => {
  const result = await render(<Text>hola expediente</Text>);
  expect(result).toBeDefined();
  expect(screen.getByText('hola expediente')).toBeTruthy();
});
