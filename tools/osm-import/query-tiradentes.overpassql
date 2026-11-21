[out:json][timeout:60];
(
  way["highway"](-25.4325,-49.2760,-25.4280,-49.2690);
  way["building"](-25.4325,-49.2760,-25.4280,-49.2690);
  relation["building"](-25.4325,-49.2760,-25.4280,-49.2690);
  way["leisure"~"park|garden"](-25.4325,-49.2760,-25.4280,-49.2690);
  way["place"="square"](-25.4325,-49.2760,-25.4280,-49.2690);
  way["area:highway"](-25.4325,-49.2760,-25.4280,-49.2690);
  node["natural"="tree"](-25.4325,-49.2760,-25.4280,-49.2690);
  node["highway"~"traffic_signals|street_lamp|bus_stop"](-25.4325,-49.2760,-25.4280,-49.2690);
  nwr["historic"](-25.4325,-49.2760,-25.4280,-49.2690);
);
out body geom;
