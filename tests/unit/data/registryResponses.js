// mysql:latest
const ociIndex = {
  manifests: [
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'amd64',
        'org.opencontainers.image.base.digest':
          'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-01T01:49:08Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'amd64', os: 'linux' },
      size: 2855,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'amd64',
        'vnd.docker.reference.digest':
          'sha256:d4990507327f4d08aaf57d9c7e2e0250260e9f6ef7fa0e0bfe822c37ad2e1b2f',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:fc88aa38fce5a0c3be54d4cfd0dda9c351854c5d28285509baedf4f322f7d755',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'arm64v8',
        'org.opencontainers.image.base.digest':
          'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-02T00:58:55Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'arm64', os: 'linux', variant: 'v8' },
      size: 2857,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'arm64v8',
        'vnd.docker.reference.digest':
          'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:01efa5c8f1824bd63acbd8736a48cb22f117881b7574b0052a385b7251dc1061',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
  ],
  mediaType: 'application/vnd.oci.image.index.v1+json',
  schemaVersion: 2,
};

// mysql:latest
const ociManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:fcd86ff8ce8c2d30f02607e184cbfd73eb581e22a451e4a1847a102318bc2926',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:07bc88e18c4aea4343fc16a9930da57308d4df45d3d234aebcd5b1c1833ee290',
      size: 48994878,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1a9c1668bf493c4df11d8a9377aeb8ef94c277c39d700470d6757f4affe812fa',
      size: 881,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1021dda8eecff015672845c8c131d475eccb83c09569a18640c2cda4399decf2',
      size: 983004,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:fb61b56acac1145d05c716918b447019808fac364743d1232e647845748f5020',
      size: 6711529,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0bca83908a5b1425517e978c51f3b8631610670037c49db9c3663a7915e20c53',
      size: 2602,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:165e8b3d37ca389e737cbc06dbd776556f3fb96311ed68ea52825fbc64685450',
      size: 333,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:3e1b086f129564f4f57b1cf79b288cf54a9e5c3a1c43219db46a1b493d40cded',
      size: 47215103,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:dba6516684849c81829a8787e5e56a203bad4854df16430fa2e3ca837d94e1d4',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:ed90f5355e12edb07b8cdaa438ef1d088e2e3121ed5b04904aaf98e79555c572',
      size: 64786544,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0412f59ab2b5360b2f2648828b0e7dd7483aa35d13a6623fcc7752d23414e9ea',
      size: 5185,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'amd64',
    'org.opencontainers.image.base.digest':
      'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// mysql:latest
const ociManifestArm64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:61a4ee8acd701eff541d0679dda9fad4d2d0843caedad36ebd17a7b41ec4b9fa',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:da7a98631edf9304544ff835ff2891b9c7a6773ae8a8bbd8041b6ef3af01fae9',
      size: 47651991,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:226e339470841aa621f212ffd8e76f35790c7a28104dd97996ad2853894f3ba6',
      size: 884,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:2eeb0cf07c9beeda8d94a25c9e65966dd25ea12f1429af47a54670924b481a81',
      size: 913449,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0d54108df510677120ec7ac21fcf4d0eb9453a8dd56db90cdfd435daf38da8fb',
      size: 6312392,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:2e523b6e86dbd0b1cb06b5674ae8fa8aa116da11a25ecbd8dd53457590f2571a',
      size: 2609,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:82dcf16e72cf33448e9f33b8c62b6c1552cb81a66ff80daa0eece2c353874e6a',
      size: 332,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:4e8f1c8c168a546aca98897bb3330afc7e0075abe929da8fdd0679a7a00825c3',
      size: 46082893,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:326faf5381746f13b1257ec7df0b686db4d7ecdae64b4528f0ed0f79893670e6',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:d91dac12e95143ff54548a09769dbfad4fb1dbd593be311bc8233dd53d8cf25c',
      size: 64959326,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:643e46c3934422f23e956fd47bcd992c86c30115678c3c9aa81b91a5b6460a23',
      size: 5182,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'arm64v8',
    'org.opencontainers.image.base.digest':
      'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// phpmyadmin:latest
const distributionManifestList = {
  manifests: [
    {
      digest:
        'sha256:2c62993fdc4eef2077030894893391a8d1b4b785106f25495af734e474c7c019',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'amd64', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:ac86587c8ae0ab295ea8f71fdf133f4adf5d3a289c5b97cd5555623eef8fe2dc',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm', os: 'linux', variant: 'v5' },
      size: 4080,
    },
    {
      digest:
        'sha256:2a74670d7b4eb4abe0cdf656d60370b21728e810a61704a618d01df9bb5b017e',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm', os: 'linux', variant: 'v7' },
      size: 4079,
    },
    {
      digest:
        'sha256:fe983a72f65856381bbf5376f5bd1f3a6961ee83bfd7f0d35e087ac655b3688a',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'arm64', os: 'linux', variant: 'v8' },
      size: 4080,
    },
    {
      digest:
        'sha256:94a416e0f2a6ffc28e68f86616739cd211eab91ad092e23ac92a6c2759a2a5e4',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: '386', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:2fec163305d0361a996ee6877b410e55ceec18e715e7c536e55289450880f7f3',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 4080,
    },
    {
      digest:
        'sha256:7ae932f82ae089a9558f27b1e08024931ea81b2a70599498db904dee53a91044',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'ppc64le', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:d30203e99d1457ce1e56c3f0c829b05e09771a88b1ea9b09d1b609fa6b6e43b6',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 's390x', os: 'linux' },
      size: 4080,
    },
  ],
  mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
  schemaVersion: 2,
};

// phpmyadmin:latest
const distributionManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22062,
    digest:
      'sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29150411,
      digest:
        'sha256:09f376ebb190216b0459f470e71bec7b5dfa611d66bf008492b40dcc5f1d8eae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 225,
      digest:
        'sha256:76afcdc8655129b4b8245d674820f06020b8a54f3db6c8d9147234b985f3c923',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 104357718,
      digest:
        'sha256:ceed4541c527d7a443908138f347495ec250ba7a1e70d8dd6b567464064ee115',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 270,
      digest:
        'sha256:9ec84be954b08b2782f93426799a585ad7b33b0e7d57b3f725218d450ea5d20d',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20329735,
      digest:
        'sha256:ff0e278869f981b14b52a6f43e6a0ce131ed2f3067de4314ed34393669549724',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 474,
      digest:
        'sha256:1693466e4cc6edc54994f2c9c9e1989f28b0df6243b3c709876e36a999aac7ee',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 510,
      digest:
        'sha256:57c8d94a4882fa141e8c25a4a5ea1f1188629cc772674bdc7dcd69c13a07bd25',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428793,
      digest:
        'sha256:43af3fe8136ad9261342f5add4a18489a3ffc70ba50f2651ea7cc1b3d0e45875',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:ddef75e08a5d03695ba1b0ce20598e067646188c87a8367b98c0b1768a280b7f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 11407606,
      digest:
        'sha256:a4ba0bdbbf0a7e73b6acc7dcd82c8dbc4635884963f73bbebcbac1a2f988cf99',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:29e89bc69515a29ca19a9f9d5159e84862484ce94772369f8eb8ea55471b22ae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 246,
      digest:
        'sha256:bdad2781572257d109331576ace9e6292ca5bab9a8d069e9f59bf185db3c1b29',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 893,
      digest:
        'sha256:dbbbc9a8833202619954978f80ebc0a2284f0e0b248972d29a930f7461853b61',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3212419,
      digest:
        'sha256:dbb7df25a76e3f547e39f1d1c6446fec585440ab4bda3ce2d3cf9a860ab7c990',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 582,
      digest:
        'sha256:2cedf1ee513bf5eda7415e9d81a011565ce786aca7d29688d54b7569b64e0179',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016080,
      digest:
        'sha256:b29f15d25d619f8fdbf3f5241916c85e91a1e7f13c4ca7809f81c0c8cf43049c',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:0c455ba0c479f0e90ff42487c0bbc46a9a6fb9479e687ad62b883c85b1c2dd38',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 928,
      digest:
        'sha256:87f4d138451a04e398076c63aae11f592e796f19b6c4be27457ef128df3736da',
    },
  ],
};

// phpmyadmin:latest
const distributionManifestArm64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22078,
    digest:
      'sha256:bb15456fda6b025376be18e4d6a55dfe1379a0595b38019a1c6e7c19d4f12b41',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29179503,
      digest:
        'sha256:24c63b8dcb66721062f32b893ef1027404afddd62aade87f3f39a3a6e70a74d0',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 227,
      digest:
        'sha256:39b7dc80a604e2d946f854c281d86a632c7990a3102971c1d4e21a1d38646608',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 98132609,
      digest:
        'sha256:344cef50aac5b8a976b3c008872a172409dee8a59088b27d80f3eea602550bd1',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 268,
      digest:
        'sha256:7f8858b20eb874693369b0e22400077725368077e44fbc30d7bf0e7120e77bc1',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20322465,
      digest:
        'sha256:33ffd5ecc100a124cb73cfac0e4259b830e97946a60c2cfad58e7e466e15cba7',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 471,
      digest:
        'sha256:0979b7b79b87f64b24acab726c0370bdd80c82efe2602c6bdf36b549c62cad91',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 513,
      digest:
        'sha256:f418b51bb40328f0c0d56bbd29006fdf292ff649fc38836189e89f33c27c0a94',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428430,
      digest:
        'sha256:8238673353aa1e651316a7785a8be3df8380c10e0b09544d58a02e6c8cf9e5bc',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:792849d38ff0788197ea6bc2d40206ddbd4cfb081b964dcc0f3c767e39efbfbf',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 11414533,
      digest:
        'sha256:537518cc819e577b0936cb81f2beffa78563e19a75596951c080546afee7d5e2',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:babe5c9e46f997637b40d1490e4e8594c3053273ec903619dc0c2f1e8b013ff4',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 247,
      digest:
        'sha256:841e0f2798e209d0e893edcbb6abf62f9f2bd79e0e0dbf40cfe86c55c69d7a63',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 894,
      digest:
        'sha256:b278bf9d6faf7def4938b8616cb27e1ddee2000e7ec06afc3463fa5d4532588f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3462603,
      digest:
        'sha256:4f99e97c6ba74f6dc3679e233e80ebe40c133681417e72301cfefe75fd9a78a4',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 583,
      digest:
        'sha256:21765477835bb1764c2979ccac2c584868a9c8bde7c5f2cedc5190d5dd70ae4f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016151,
      digest:
        'sha256:1aee002f2df3fbb431ee148eb79ae56077ea1f922b4dcddfb736a2168fe72cf7',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:f855ac4c0ab6239868635a71af6106bdf0b22894e7ef802333ea4ba589862f5a',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 930,
      digest:
        'sha256:23ffa052a82622734de8425815a9a4c8d1d5088ef1361ec1dab3532a1bed007e',
    },
  ],
};

// made up
const oversizeDistributionManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: {
    mediaType: 'application/vnd.docker.container.image.v1+json',
    size: 22062,
    digest:
      'sha256:87a2490a12aed4100891be53b521da77508dafef1d49422f7eb5088c6eb1631a',
  },
  layers: [
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 29150411,
      digest:
        'sha256:09f376ebb190216b0459f470e71bec7b5dfa611d66bf008492b40dcc5f1d8eae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 225,
      digest:
        'sha256:76afcdc8655129b4b8245d674820f06020b8a54f3db6c8d9147234b985f3c923',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 104357718,
      digest:
        'sha256:ceed4541c527d7a443908138f347495ec250ba7a1e70d8dd6b567464064ee115',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 270,
      digest:
        'sha256:9ec84be954b08b2782f93426799a585ad7b33b0e7d57b3f725218d450ea5d20d',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 20329735,
      digest:
        'sha256:ff0e278869f981b14b52a6f43e6a0ce131ed2f3067de4314ed34393669549724',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 474,
      digest:
        'sha256:1693466e4cc6edc54994f2c9c9e1989f28b0df6243b3c709876e36a999aac7ee',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 510,
      digest:
        'sha256:57c8d94a4882fa141e8c25a4a5ea1f1188629cc772674bdc7dcd69c13a07bd25',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 12428793,
      digest:
        'sha256:43af3fe8136ad9261342f5add4a18489a3ffc70ba50f2651ea7cc1b3d0e45875',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 491,
      digest:
        'sha256:ddef75e08a5d03695ba1b0ce20598e067646188c87a8367b98c0b1768a280b7f',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      // yuge
      size: 1140760600000,
      digest:
        'sha256:a4ba0bdbbf0a7e73b6acc7dcd82c8dbc4635884963f73bbebcbac1a2f988cf99',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 2457,
      digest:
        'sha256:29e89bc69515a29ca19a9f9d5159e84862484ce94772369f8eb8ea55471b22ae',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 246,
      digest:
        'sha256:bdad2781572257d109331576ace9e6292ca5bab9a8d069e9f59bf185db3c1b29',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 893,
      digest:
        'sha256:dbbbc9a8833202619954978f80ebc0a2284f0e0b248972d29a930f7461853b61',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 3212419,
      digest:
        'sha256:dbb7df25a76e3f547e39f1d1c6446fec585440ab4bda3ce2d3cf9a860ab7c990',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 582,
      digest:
        'sha256:2cedf1ee513bf5eda7415e9d81a011565ce786aca7d29688d54b7569b64e0179',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 13016080,
      digest:
        'sha256:b29f15d25d619f8fdbf3f5241916c85e91a1e7f13c4ca7809f81c0c8cf43049c',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 1615,
      digest:
        'sha256:0c455ba0c479f0e90ff42487c0bbc46a9a6fb9479e687ad62b883c85b1c2dd38',
    },
    {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 928,
      digest:
        'sha256:87f4d138451a04e398076c63aae11f592e796f19b6c4be27457ef128df3736da',
    },
  ],
};

// made up
const oversizeOciManifestAmd64 = {
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  config: {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest:
      'sha256:fcd86ff8ce8c2d30f02607e184cbfd73eb581e22a451e4a1847a102318bc2926',
    size: 6469,
  },
  layers: [
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:07bc88e18c4aea4343fc16a9930da57308d4df45d3d234aebcd5b1c1833ee290',
      size: 48994878,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1a9c1668bf493c4df11d8a9377aeb8ef94c277c39d700470d6757f4affe812fa',
      size: 881,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:1021dda8eecff015672845c8c131d475eccb83c09569a18640c2cda4399decf2',
      size: 983004,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:fb61b56acac1145d05c716918b447019808fac364743d1232e647845748f5020',
      // yuge
      size: 67115291234,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0bca83908a5b1425517e978c51f3b8631610670037c49db9c3663a7915e20c53',
      size: 2602,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:165e8b3d37ca389e737cbc06dbd776556f3fb96311ed68ea52825fbc64685450',
      size: 333,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:3e1b086f129564f4f57b1cf79b288cf54a9e5c3a1c43219db46a1b493d40cded',
      size: 47215103,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:dba6516684849c81829a8787e5e56a203bad4854df16430fa2e3ca837d94e1d4',
      size: 321,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:ed90f5355e12edb07b8cdaa438ef1d088e2e3121ed5b04904aaf98e79555c572',
      size: 64786544,
    },
    {
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest:
        'sha256:0412f59ab2b5360b2f2648828b0e7dd7483aa35d13a6623fcc7752d23414e9ea',
      size: 5185,
    },
  ],
  annotations: {
    'com.docker.official-images.bashbrew.arch': 'amd64',
    'org.opencontainers.image.base.digest':
      'sha256:17e0ec828e5081c793897eba78a44fcc96df147d98c9564b5505ac1e1445dc5b',
    'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
    'org.opencontainers.image.created': '2024-05-01T07:22:24Z',
    'org.opencontainers.image.revision':
      'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
    'org.opencontainers.image.source':
      'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
    'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
    'org.opencontainers.image.version': '8.4.0',
  },
};

// made up
const distributionManifestListUnsupported = {
  manifests: [
    {
      digest:
        'sha256:94a416e0f2a6ffc28e68f86616739cd211eab91ad092e23ac92a6c2759a2a5e4',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: '386', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:2fec163305d0361a996ee6877b410e55ceec18e715e7c536e55289450880f7f3',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 4080,
    },
    {
      digest:
        'sha256:7ae932f82ae089a9558f27b1e08024931ea81b2a70599498db904dee53a91044',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 'ppc64le', os: 'linux' },
      size: 4081,
    },
    {
      digest:
        'sha256:d30203e99d1457ce1e56c3f0c829b05e09771a88b1ea9b09d1b609fa6b6e43b6',
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      platform: { architecture: 's390x', os: 'linux' },
      size: 4080,
    },
  ],
  mediaType: 'application/vnd.docker.distribution.manifest.list.v2+json',
  schemaVersion: 2,
};

const ociIndexUnsupported = {
  manifests: [
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'mips64le',
        'org.opencontainers.image.base.digest':
          'sha256:fb9586c7851f02af477d6a9f80036fb01ffcf263583d017750a90fb3abc76e6b',
        'org.opencontainers.image.base.name': 'oraclelinux:9-slim',
        'org.opencontainers.image.created': '2024-06-02T00:58:55Z',
        'org.opencontainers.image.revision':
          'a15b34a032f48089ee7b02d307d8f89a96b3bb76',
        'org.opencontainers.image.source':
          'https://github.com/docker-library/mysql.git#a15b34a032f48089ee7b02d307d8f89a96b3bb76:8.4',
        'org.opencontainers.image.url': 'https://hub.docker.com/_/mysql',
        'org.opencontainers.image.version': '8.4.0',
      },
      digest:
        'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'mips64le', os: 'linux' },
      size: 2857,
    },
    {
      annotations: {
        'com.docker.official-images.bashbrew.arch': 'mips64le',
        'vnd.docker.reference.digest':
          'sha256:dcc6b4356cc567e868a96085402ecc10555a3d2a5b4a7d5e86172b21fe2a7890',
        'vnd.docker.reference.type': 'attestation-manifest',
      },
      digest:
        'sha256:01efa5c8f1824bd63acbd8736a48cb22f117881b7574b0052a385b7251dc1061',
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      platform: { architecture: 'unknown', os: 'unknown' },
      size: 842,
    },
  ],
  mediaType: 'application/vnd.oci.image.index.v1+json',
  schemaVersion: 2,
};

module.exports = {
  ociIndex,
  ociIndexUnsupported,
  ociManifestAmd64,
  ociManifestArm64,
  distributionManifestList,
  distributionManifestListUnsupported,
  distributionManifestAmd64,
  distributionManifestArm64,
  oversizeDistributionManifestAmd64,
  oversizeOciManifestAmd64,
};
