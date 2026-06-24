import { AppBar, Box, Container, Stack, Toolbar, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';

function BrandMark() {
  return (
    <Box className="kdx-mark" aria-hidden="true">
      <Box className="kdx-mark__blade kdx-mark__blade--dark" />
      <Box className="kdx-mark__blade kdx-mark__blade--mint" />
      <Box className="kdx-mark__blade kdx-mark__blade--soft" />
    </Box>
  );
}

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="static"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(255, 255, 255, 0.96)' }}
      >
        <Toolbar sx={{ minHeight: { xs: 72, sm: 84 }, px: { xs: 2, sm: 4 } }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
            <BrandMark />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" sx={{ lineHeight: 1, fontWeight: 900, color: 'text.primary' }}>
                KronosDX
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: 'primary.main', fontWeight: 900, letterSpacing: 1.8, textTransform: 'uppercase' }}
              >
                KDX Server Deployment Toolkit
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Typography
              variant="body2"
              sx={{ display: { xs: 'none', md: 'block' }, color: 'text.secondary', fontWeight: 700 }}
            >
              Bare Metal Discovery & Lifecycle Platform
            </Typography>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: { xs: 2.5, md: 4 } }}>
        <Outlet />
      </Container>
    </Box>
  );
}
