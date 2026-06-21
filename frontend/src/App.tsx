import { AppBar, Box, Container, Stack, Toolbar, Typography } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import { Outlet } from 'react-router-dom';

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} color="inherit" sx={{ borderBottom: '1px solid #d8dee8' }}>
        <Toolbar>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <StorageIcon color="primary" />
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1.1, fontWeight: 800 }}>
                KDX SDT
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Bare Metal Discovery & Deployment Platform
              </Typography>
            </Box>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
