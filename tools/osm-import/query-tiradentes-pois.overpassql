[out:json][timeout:90];
(
  nwr["shop"](-25.4325,-49.2760,-25.4280,-49.2690);
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|library|police|clinic|marketplace|ice_cream|townhall|post_office|theatre|cinema|atm|bench|place_of_worship|arts_centre|food_court)$"](-25.4325,-49.2760,-25.4280,-49.2690);
  nwr["tourism"~"^(museum|hotel|artwork|information|gallery)$"](-25.4325,-49.2760,-25.4280,-49.2690);
  nwr["office"](-25.4325,-49.2760,-25.4280,-49.2690);
  node["entrance"](-25.4325,-49.2760,-25.4280,-49.2690);
);
out center tags;
