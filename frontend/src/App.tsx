import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import { Link as RouterLink, Outlet } from 'react-router-dom';
import { TaskFooter } from './components/TaskFooter';

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
                KDX SDT
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: 1.8, textTransform: 'uppercase' }}
              >
                Server Deployment Toolkit
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <Button component={RouterLink} to="/" startIcon={<StorageIcon />} variant="outlined" size="small">
                Inventory
              </Button>
              <Button component={RouterLink} to="/bios/profiles" startIcon={<TuneIcon />} variant="outlined" size="small">
                BIOS Profiles
              </Button>
              <Button component={RouterLink} to="/setup" startIcon={<SettingsIcon />} variant="outlined" size="small">
                Settings
              </Button>
            </Stack>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ pt: { xs: 2.5, md: 4 }, pb: { xs: 12, md: 14 } }}>
        <Outlet />
      </Container>
      <TaskFooter />
    </Box>
  );
}
