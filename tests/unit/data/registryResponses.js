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
      'sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8',
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
    size: 22081,
    digest:
      'sha256:45f016fd20cba4a17403b716b3cf1145e57812012934a79bb80b7b4a10f5438a',
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

// phpmyadmin:latest (config)

const imageConfigArm64 = {
  architecture: 'arm64',
  config: {
    Hostname: '',
    Domainname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: {
      '80/tcp': {},
    },
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      'PHP_INI_DIR=/usr/local/etc/php',
      'APACHE_CONFDIR=/etc/apache2',
      'APACHE_ENVVARS=/etc/apache2/envvars',
      'PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_LDFLAGS=-Wl,-O1 -pie',
      'GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      'PHP_VERSION=8.2.20',
      'PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz',
      'PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      'PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      'MAX_EXECUTION_TIME=600',
      'MEMORY_LIMIT=512M',
      'UPLOAD_LIMIT=2048K',
      'TZ=UTC',
      'SESSION_SAVE_PATH=/sessions',
      'VERSION=5.2.1',
      'SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      'URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
    ],
    Cmd: [
      'apache2-foreground',
    ],
    Image: 'sha256:2c67feea200e7de40c61fc910b8db697eff54b870cc81a18b44b2969eab60db2',
    Volumes: null,
    WorkingDir: '/var/www/html',
    Entrypoint: [
      '/docker-entrypoint.sh',
    ],
    OnBuild: null,
    Labels: {
      'org.opencontainers.image.authors': 'The phpMyAdmin Team <developers@phpmyadmin.net>',
      'org.opencontainers.image.description': 'Run phpMyAdmin with Alpine, Apache and PHP FPM.',
      'org.opencontainers.image.documentation': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.licenses': 'GPL-2.0-only',
      'org.opencontainers.image.source': 'https://github.com/phpmyadmin/docker.git',
      'org.opencontainers.image.title': 'Official phpMyAdmin Docker image',
      'org.opencontainers.image.url': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.vendor': 'phpMyAdmin',
      'org.opencontainers.image.version': '5.2.1',
    },
    StopSignal: 'SIGWINCH',
  },
  container: 'bf2c88c233a939715e7f193db8aea54c74548d65b865be8432a674ca80f8f3ba',
  container_config: {
    Hostname: 'bf2c88c233a9',
    Domainname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: {
      '80/tcp': {},
    },
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      'PHP_INI_DIR=/usr/local/etc/php',
      'APACHE_CONFDIR=/etc/apache2',
      'APACHE_ENVVARS=/etc/apache2/envvars',
      'PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      'PHP_LDFLAGS=-Wl,-O1 -pie',
      'GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      'PHP_VERSION=8.2.20',
      'PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz',
      'PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      'PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      'MAX_EXECUTION_TIME=600',
      'MEMORY_LIMIT=512M',
      'UPLOAD_LIMIT=2048K',
      'TZ=UTC',
      'SESSION_SAVE_PATH=/sessions',
      'VERSION=5.2.1',
      'SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      'URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
    ],
    Cmd: [
      '/bin/sh',
      '-c',
      '#(nop) ',
      'CMD ["apache2-foreground"]',
    ],
    Image: 'sha256:2c67feea200e7de40c61fc910b8db697eff54b870cc81a18b44b2969eab60db2',
    Volumes: null,
    WorkingDir: '/var/www/html',
    Entrypoint: [
      '/docker-entrypoint.sh',
    ],
    OnBuild: null,
    Labels: {
      'org.opencontainers.image.authors': 'The phpMyAdmin Team <developers@phpmyadmin.net>',
      'org.opencontainers.image.description': 'Run phpMyAdmin with Alpine, Apache and PHP FPM.',
      'org.opencontainers.image.documentation': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.licenses': 'GPL-2.0-only',
      'org.opencontainers.image.source': 'https://github.com/phpmyadmin/docker.git',
      'org.opencontainers.image.title': 'Official phpMyAdmin Docker image',
      'org.opencontainers.image.url': 'https://github.com/phpmyadmin/docker#readme',
      'org.opencontainers.image.vendor': 'phpMyAdmin',
      'org.opencontainers.image.version': '5.2.1',
    },
    StopSignal: 'SIGWINCH',
  },
  created: '2024-06-13T10:33:26.127447166Z',
  docker_version: '23.0.11',
  history: [
    {
      created: '2024-06-13T00:39:50.489759524Z',
      created_by: '/bin/sh -c #(nop) ADD file:5f17f77072bcd27aa8c4d09ef5117423b789c42445b6e6c13af711dfb2abd544 in / ',
    },
    {
      created: '2024-06-13T00:39:51.001674137Z',
      created_by: '/bin/sh -c #(nop)  CMD ["bash"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:27.337506469Z',
      created_by: "/bin/sh -c set -eux; \t{ \t\techo 'Package: php*'; \t\techo 'Pin: release *'; \t\techo 'Pin-Priority: -1'; \t} > /etc/apt/preferences.d/no-debian-php",
    },
    {
      created: '2024-06-13T05:31:27.434120664Z',
      created_by: '/bin/sh -c #(nop)  ENV PHPIZE_DEPS=autoconf \t\tdpkg-dev \t\tfile \t\tg++ \t\tgcc \t\tlibc-dev \t\tmake \t\tpkg-config \t\tre2c',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:42.599095369Z',
      created_by: '/bin/sh -c set -eux; \tapt-get update; \tapt-get install -y --no-install-recommends \t\t$PHPIZE_DEPS \t\tca-certificates \t\tcurl \t\txz-utils \t; \trm -rf /var/lib/apt/lists/*',
    },
    {
      created: '2024-06-13T05:31:44.297500492Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_INI_DIR=/usr/local/etc/php',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:31:44.757158498Z',
      created_by: '/bin/sh -c set -eux; \tmkdir -p "$PHP_INI_DIR/conf.d"; \t[ ! -d /var/www/html ]; \tmkdir -p /var/www/html; \tchown www-data:www-data /var/www/html; \tchmod 1777 /var/www/html',
    },
    {
      created: '2024-06-13T05:35:35.257056185Z',
      created_by: '/bin/sh -c #(nop)  ENV APACHE_CONFDIR=/etc/apache2',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:35.347240554Z',
      created_by: '/bin/sh -c #(nop)  ENV APACHE_ENVVARS=/etc/apache2/envvars',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:42.496173836Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.216631066Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.679700359Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T05:35:43.771486037Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_CFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:43.86198167Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_CPPFLAGS=-fstack-protector-strong -fpic -fpie -O2 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64',
      empty_layer: true,
    },
    {
      created: '2024-06-13T05:35:43.955633155Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_LDFLAGS=-Wl,-O1 -pie',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.474584842Z',
      created_by: '/bin/sh -c #(nop)  ENV GPG_KEYS=39B641343D8C104B2B146DC3F9C39DC0B9698544 E60913E4DF209907D8E30D96659A97C9CF2A795A 1198C0117593497A5EC5C199286AF1F9897469DC',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.569977076Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_VERSION=8.2.20',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.667349271Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_URL=https://www.php.net/distributions/php-8.2.20.tar.xz PHP_ASC_URL=https://www.php.net/distributions/php-8.2.20.tar.xz.asc',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:50.767304905Z',
      created_by: '/bin/sh -c #(nop)  ENV PHP_SHA256=4474cc430febef6de7be958f2c37253e5524d5c5331a7e1765cd2d2234881e50',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:03:59.381037511Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T06:03:59.535533927Z',
      created_by: '/bin/sh -c #(nop) COPY file:ce57c04b70896f77cc11eb2766417d8a1240fcffe5bba92179ec78c458844110 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:12.392267655Z',
      created_by: "/bin/sh -c set -eux; \t\tsavedAptMark=\"$(apt-mark showmanual)\"; \tapt-get update; \tapt-get install -y --no-install-recommends \t\tapache2-dev \t\tlibargon2-dev \t\tlibcurl4-openssl-dev \t\tlibonig-dev \t\tlibreadline-dev \t\tlibsodium-dev \t\tlibsqlite3-dev \t\tlibssl-dev \t\tlibxml2-dev \t\tzlib1g-dev \t; \t\texport \t\tCFLAGS=\"$PHP_CFLAGS\" \t\tCPPFLAGS=\"$PHP_CPPFLAGS\" \t\tLDFLAGS=\"$PHP_LDFLAGS\" \t\tPHP_BUILD_PROVIDER='https://github.com/docker-library/php' \t\tPHP_UNAME='Linux - Docker' \t; \tdocker-php-source extract; \tcd /usr/src/php; \tgnuArch=\"$(dpkg-architecture --query DEB_BUILD_GNU_TYPE)\"; \tdebMultiarch=\"$(dpkg-architecture --query DEB_BUILD_MULTIARCH)\"; \tif [ ! -d /usr/include/curl ]; then \t\tln -sT \"/usr/include/$debMultiarch/curl\" /usr/local/include/curl; \tfi; \t./configure \t\t--build=\"$gnuArch\" \t\t--with-config-file-path=\"$PHP_INI_DIR\" \t\t--with-config-file-scan-dir=\"$PHP_INI_DIR/conf.d\" \t\t\t\t--enable-option-checking=fatal \t\t\t\t--with-mhash \t\t\t\t--with-pic \t\t\t\t--enable-mbstring \t\t--enable-mysqlnd \t\t--with-password-argon2 \t\t--with-sodium=shared \t\t--with-pdo-sqlite=/usr \t\t--with-sqlite3=/usr \t\t\t\t--with-curl \t\t--with-iconv \t\t--with-openssl \t\t--with-readline \t\t--with-zlib \t\t\t\t--disable-phpdbg \t\t\t\t--with-pear \t\t\t\t$(test \"$gnuArch\" = 'riscv64-linux-gnu' && echo '--without-pcre-jit') \t\t--with-libdir=\"lib/$debMultiarch\" \t\t\t\t--disable-cgi \t\t\t\t--with-apxs2 \t; \tmake -j \"$(nproc)\"; \tfind -type f -name '*.a' -delete; \tmake install; \tfind \t\t/usr/local \t\t-type f \t\t-perm '/0111' \t\t-exec sh -euxc ' \t\t\tstrip --strip-all \"$@\" || : \t\t' -- '{}' + \t; \tmake clean; \t\tcp -v php.ini-* \"$PHP_INI_DIR/\"; \t\tcd /; \tdocker-php-source delete; \t\tapt-mark auto '.*' > /dev/null; \t[ -z \"$savedAptMark\" ] || apt-mark manual $savedAptMark; \tfind /usr/local -type f -executable -exec ldd '{}' ';' \t\t| awk '/=>/ { so = $(NF-1); if (index(so, \"/usr/local/\") == 1) { next }; gsub(\"^/(usr/)?\", \"\", so); printf \"*%s\\n\", so }' \t\t| sort -u \t\t| xargs -r dpkg-query --search \t\t| cut -d: -f1 \t\t| sort -u \t\t| xargs -r apt-mark manual \t; \tapt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \trm -rf /var/lib/apt/lists/*; \t\tpecl update-channels; \trm -rf /tmp/pear ~/.pearrc; \t\tphp --version",
    },
    {
      created: '2024-06-13T06:07:12.716287922Z',
      created_by: '/bin/sh -c #(nop) COPY multi:e11221d43af7136e4dbad5a74e659bcfa753214a9e615c3daf357f1633d9d3d1 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:13.203548326Z',
      created_by: '/bin/sh -c docker-php-ext-enable sodium',
    },
    {
      created: '2024-06-13T06:07:13.358228599Z',
      created_by: '/bin/sh -c #(nop)  ENTRYPOINT ["docker-php-entrypoint"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.452433348Z',
      created_by: '/bin/sh -c #(nop)  STOPSIGNAL SIGWINCH',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.552063667Z',
      created_by: '/bin/sh -c #(nop) COPY file:e3123fcb6566efa979f945bfac1c94c854a559d7b82723e42118882a8ac4de66 in /usr/local/bin/ ',
    },
    {
      created: '2024-06-13T06:07:13.647192913Z',
      created_by: '/bin/sh -c #(nop) WORKDIR /var/www/html',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.737108588Z',
      created_by: '/bin/sh -c #(nop)  EXPOSE 80',
      empty_layer: true,
    },
    {
      created: '2024-06-13T06:07:13.833452068Z',
      created_by: '/bin/sh -c #(nop)  CMD ["apache2-foreground"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:14.82107478Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:14.975181338Z',
      created_by: '/bin/sh -c #(nop)  ENV MAX_EXECUTION_TIME=600',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.069389391Z',
      created_by: '/bin/sh -c #(nop)  ENV MEMORY_LIMIT=512M',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.164442845Z',
      created_by: '/bin/sh -c #(nop)  ENV UPLOAD_LIMIT=2048K',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.258040428Z',
      created_by: '/bin/sh -c #(nop)  ENV TZ=UTC',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.353873797Z',
      created_by: '/bin/sh -c #(nop)  ENV SESSION_SAVE_PATH=/sessions',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:15.826784525Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:15.920682434Z',
      created_by: '/bin/sh -c #(nop)  ENV VERSION=5.2.1',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.016311856Z',
      created_by: '/bin/sh -c #(nop)  ENV SHA256=373f9599dfbd96d6fe75316d5dad189e68c305f297edf42377db9dd6b41b2557',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.111034053Z',
      created_by: '/bin/sh -c #(nop)  ENV URL=https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.xz',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:16.206581258Z',
      created_by: '/bin/sh -c #(nop)  LABEL org.opencontainers.image.title=Official phpMyAdmin Docker image org.opencontainers.image.description=Run phpMyAdmin with Alpine, Apache and PHP FPM. org.opencontainers.image.authors=The phpMyAdmin Team <developers@phpmyadmin.net> org.opencontainers.image.vendor=phpMyAdmin org.opencontainers.image.documentation=https://github.com/phpmyadmin/docker#readme org.opencontainers.image.licenses=GPL-2.0-only org.opencontainers.image.version=5.2.1 org.opencontainers.image.url=https://github.com/phpmyadmin/docker#readme org.opencontainers.image.source=https://github.com/phpmyadmin/docker.git',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:25.489636493Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
    },
    {
      created: '2024-06-13T10:33:25.835738873Z',
      created_by: '/bin/sh -c #(nop) COPY file:f697d9b67ffcb023f485f153138036d27b209f81ffe35ce3b93a825c617138cd in /etc/phpmyadmin/config.inc.php ',
    },
    {
      created: '2024-06-13T10:33:25.94764847Z',
      created_by: '/bin/sh -c #(nop) COPY file:4c44b9819df4178e9ea9cadac940244ec91f94d66f4c1ab6f3707a059dcd485c in /docker-entrypoint.sh ',
    },
    {
      created: '2024-06-13T10:33:26.033735095Z',
      created_by: '/bin/sh -c #(nop)  ENTRYPOINT ["/docker-entrypoint.sh"]',
      empty_layer: true,
    },
    {
      created: '2024-06-13T10:33:26.127447166Z',
      created_by: '/bin/sh -c #(nop)  CMD ["apache2-foreground"]',
      empty_layer: true,
    },
  ],
  os: 'linux',
  rootfs: {
    type: 'layers',
    diff_ids: [
      'sha256:72c690143394392f22d311d60d7b2cada541166fddd89ddf69d9564f3160e0fd',
      'sha256:2ca469df2d7a64c1ce3fa8c98f94112c4b4a1760efdc68a35b2ac0b4d3280ff0',
      'sha256:ecbda56a4ecd649c1b14765acf5d6055c50927ddee37bea93150cb42bb872fb9',
      'sha256:5a578fe88ffcb0dd4e6605faddd7fe9979efd51ab370f0fc88365f67f97498c1',
      'sha256:3f33b2d8d4bcad157068182e90b8b5adcc157c51233849d7405c1e1747cc513a',
      'sha256:8cb0c7be5c25df0616ee3a2f0ee9418a3b2686bc1ea3273ab9e19deb36fff8c9',
      'sha256:21fd75a3f453bf57a64d5ed1694e9e85d15feeaa63afeebfa8301d5ba1208b8f',
      'sha256:e96b94137eb634833e7f7718fe3b64999e1de8305549bd1d229972e67ff59711',
      'sha256:c3589190f5be5ec7bc53d57179208569bcd91ce28c287eaa8b9d088618c97c4e',
      'sha256:e59e93e1c54efd8b6fb9f712a89e020bc99c101615b6e1f1095deb705acfbd9c',
      'sha256:3dd11762b08d03a100eeef942310cd68c48476ae704bd5bc2e93e8271d2eeb53',
      'sha256:60b6a6afca7aa5ea9dd3953ea8724c334d27c2c4ab0cf00e37e7670de490eb73',
      'sha256:df2e661dca7992d2fa1f645e87e3eab90ff2b770b7dda5774f6f8aa41846f422',
      'sha256:5c7c06a5493314b5582de393693f5381ba81d62386e29ef8a1a5af27b563a858',
      'sha256:4f0f66e38a64759ea918d3d6a2dc43ad65870a878e82392f460bc7d06729cb2a',
      'sha256:35611a4633bf186d1be9ce71c05b9ef27688f223042fbd33fc18b43cd2551f5c',
      'sha256:1b66a7e8d178fd52ff61d6f9f6f4aa42895b6f2d2466c05f937076660cfba6f8',
      'sha256:6621e6566368be8d65172801a6880fca8aad7010565bfc36be313b181728c736',
    ],
  },
  variant: 'v8',
};

// megachips/ipshow (Config)
const imageConfigAmd64 = {
  architecture: 'amd64',
  config: {
    Env: [
      'PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'LANG=C.UTF-8',
      'GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D',
      'PYTHON_VERSION=3.11.7',
      'PYTHON_PIP_VERSION=23.2.1',
      'PYTHON_SETUPTOOLS_VERSION=65.5.1',
      'PYTHON_GET_PIP_URL=https://github.com/pypa/get-pip/raw/049c52c665e8c5fd1751f942316e0a5c777d304f/public/get-pip.py',
      'PYTHON_GET_PIP_SHA256=7cfd4bdc4d475ea971f1c0710a5953bcc704d171f83c797b9529d9974502fcc6',
    ],
    Entrypoint: [
      'python3',
      'app.py',
    ],
    WorkingDir: '/app',
    ArgsEscaped: true,
    OnBuild: null,
  },
  created: '2024-01-28T08:34:02.310843905Z',
  history: [
    {
      created: '2024-01-27T00:30:48.624602109Z',
      created_by: '/bin/sh -c #(nop) ADD file:37a76ec18f9887751cd8473744917d08b7431fc4085097bb6a09d81b41775473 in / ',
    },
    {
      created: '2024-01-27T00:30:48.743965523Z',
      created_by: '/bin/sh -c #(nop)  CMD ["/bin/sh"]',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV LANG=C.UTF-8',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'RUN /bin/sh -c set -eux; \tapk add --no-cache \t\tca-certificates \t\ttzdata \t; # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV GPG_KEY=A035C8C19219BA821ECEA86B64E628F8D684696D',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_VERSION=3.11.7',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'RUN /bin/sh -c set -eux; \tfor src in idle3 pydoc3 python3 python3-config; do \t\tdst="$(echo "$src" | tr -d 3)"; \t\t[ -s "/usr/local/bin/$src" ]; \t\t[ ! -e "/usr/local/bin/$dst" ]; \t\tln -svT "$src" "/usr/local/bin/$dst"; \tdone # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_PIP_VERSION=23.2.1',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_SETUPTOOLS_VERSION=65.5.1',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_GET_PIP_URL=https://github.com/pypa/get-pip/raw/049c52c665e8c5fd1751f942316e0a5c777d304f/public/get-pip.py',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'ENV PYTHON_GET_PIP_SHA256=7cfd4bdc4d475ea971f1c0710a5953bcc704d171f83c797b9529d9974502fcc6',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: '/bin/sh -c a2dismod mpm_event && a2enmod mpm_prefork',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2023-12-20T02:14:05Z',
      created_by: 'CMD ["python3"]',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
    {
      created: '2024-01-27T21:26:58.705651175Z',
      created_by: 'WORKDIR /app',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-27T21:27:07.384920178Z',
      created_by: 'RUN /bin/sh -c pip install aiohttp accept-types # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-28T08:34:02.310843905Z',
      created_by: 'COPY app.py . # buildkit',
      comment: 'buildkit.dockerfile.v0',
    },
    {
      created: '2024-01-28T08:34:02.310843905Z',
      created_by: 'ENTRYPOINT ["python3" "app.py"]',
      comment: 'buildkit.dockerfile.v0',
      empty_layer: true,
    },
  ],
  os: 'linux',
  rootfs: {
    type: 'layers',
    diff_ids: [
      'sha256:d4fc045c9e3a848011de66f34b81f052d4f2c15a17bb196d637e526349601820',
      'sha256:678cac8b069e3d95557415ac228c218d0fff534f1282c9c791b9736f89a7cea2',
      'sha256:8fde1a6f4000d3280c06ce5fda8b977fae1ab3938447a58d59d215faf03bd58f',
      'sha256:4985f9438c299fb15bbb8756467c2638f93b7b908fdb73f0d76e9b948645a80f',
      'sha256:6cedb0fbc9d9ea9667a2d8c1c7bab0b3c4ecf75534917c596f6bd12509957c52',
      'sha256:233b76fd3ce8befb773525f7f07a8b994f977e5232a35be38a50bc26d936eb2d',
      'sha256:e322997e528a8abb04a5f1291da49994942dba0f25de9f3d52a6c810298e1612',
      'sha256:1644f563c622ede6aefd120357c692246ed0145fb83e729df26a8498012333ae',
    ],
  },
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
      'sha256:05247af918647d8d063d2e880cc65c1546a7d616cde1e6c6f5dab1ca091f6cf8',
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

/* eslint-disable max-len, vue/max-len, no-template-curly-in-string */
const schemaV1Amd64 = {
  schemaVersion: 1,
  name: 'audreyt/ethercalc',
  tag: 'latest',
  architecture: 'amd64',
  fsLayers: [
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:bb5c7462cbfc3f4aca95497563a0fcd970f9c24bcf12753b37c517a4b09b9111',
    },
    {
      blobSum: 'sha256:f1fc9067a4a1b18179ec04ff24d46e65deb04028b5652d9a2817da135359c241',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:38238ad0b0db7a02388a2cabb42f53c5135fc1224c51808f83b726d365ec6021',
    },
    {
      blobSum: 'sha256:c9a9199019d2c8be77aee17b0e682956b27aa319bd79a8ab608f7e702c1fdd91',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:6d782fdb5f10c99358441d7ea546c328c626e55720cde27495bc33e3397aedf8',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:b6df75eec292ecd9f2d8a209abc9465c1876f6319ce48aafe081a522291a65f3',
    },
    {
      blobSum: 'sha256:ca91690e422b1df8f66dd21e9234c356ccded59f8c8e927c24d1c3296d5c71e0',
    },
    {
      blobSum: 'sha256:6ad558883a035a2f483655baf501b03cf7fc4df759c7efe8f53793bc34c23f74',
    },
    {
      blobSum: 'sha256:8acc8724fd16ac465b9325c745cf13d3645cbca75dd67e827b0b1d4412619fc2',
    },
    {
      blobSum: 'sha256:7bf7fb3eb2dce2e46399c1f0efd2eff3516417033fa0559e2e44f17c015eee6c',
    },
    {
      blobSum: 'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
    },
    {
      blobSum: 'sha256:597a484e68396f8bd016db7bf8f0226ed36fe209c9d6469544551a1cacccccd1',
    },
  ],
  history: [
    {
      v1Compatibility: '{"id":"66ba885277e5e213d29d063b4b2078146c883ce2455a3f26905cfae144b0ea8c","parent":"47561fa0cc1c2f02f21c844e4693850ff19c63d05dd256b8ba73304c863d3d27","created":"2020-12-26T17:45:04.862345039Z","container":"fe172bac1dc8481e29cb0521e8208428b6fe79fe042b3973079417c21cc82764","container_config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"ExposedPorts":{"8000/tcp":{}},"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","#(nop) CMD [\\"sh\\" \\"-c\\" \\"REDIS_HOST=$REDIS_PORT_6379_TCP_ADDR REDIS_PORT=$REDIS_PORT_6379_TCP_PORT pm2 start -x `which ethercalc` -- --vm --cors \\u0026\\u0026 pm2 logs\\"]"],"Image":"47561fa0cc1c2f02f21c844e4693850ff19c63d05dd256b8ba73304c863d3d27","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"docker_version":"1.9.1","config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"ExposedPorts":{"8000/tcp":{}},"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["sh","-c","REDIS_HOST=$REDIS_PORT_6379_TCP_ADDR REDIS_PORT=$REDIS_PORT_6379_TCP_PORT pm2 start -x `which ethercalc` -- --vm --cors \\u0026\\u0026 pm2 logs"],"Image":"47561fa0cc1c2f02f21c844e4693850ff19c63d05dd256b8ba73304c863d3d27","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"architecture":"amd64","os":"linux"}',
    },
    {
      v1Compatibility: '{"id":"47561fa0cc1c2f02f21c844e4693850ff19c63d05dd256b8ba73304c863d3d27","parent":"4e5bfbbd0c6c03d96c47893907c7ab7d44781a5976dc5429a06476c8a4188a88","created":"2020-12-26T17:44:58.737236377Z","container":"f606baa48882d214616c41f69b19ae47da571ba9bf3b3766dfa804f2efa1c47b","container_config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"ExposedPorts":{"8000/tcp":{}},"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","#(nop) EXPOSE 8000/tcp"],"Image":"4e5bfbbd0c6c03d96c47893907c7ab7d44781a5976dc5429a06476c8a4188a88","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"docker_version":"1.9.1","config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"ExposedPorts":{"8000/tcp":{}},"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["node"],"Image":"4e5bfbbd0c6c03d96c47893907c7ab7d44781a5976dc5429a06476c8a4188a88","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"architecture":"amd64","os":"linux"}',
    },
    {
      v1Compatibility: '{"id":"4e5bfbbd0c6c03d96c47893907c7ab7d44781a5976dc5429a06476c8a4188a88","parent":"55c71bbec927161871af137e9d9826526e2595cd7b703bb44e4ad101d5c543a7","created":"2020-12-26T17:44:52.564123942Z","container":"70b91d1c73745e6eb4e9bc846a7c063860be29f828204c3db2f4b0166cdb2f3a","container_config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","#(nop) USER [ethercalc]"],"Image":"55c71bbec927161871af137e9d9826526e2595cd7b703bb44e4ad101d5c543a7","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"docker_version":"1.9.1","config":{"Hostname":"5f0840e2add5","Domainname":"","User":"ethercalc","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["node"],"Image":"55c71bbec927161871af137e9d9826526e2595cd7b703bb44e4ad101d5c543a7","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"architecture":"amd64","os":"linux"}',
    },
    {
      v1Compatibility: '{"id":"55c71bbec927161871af137e9d9826526e2595cd7b703bb44e4ad101d5c543a7","parent":"cb4d76f9783d4d8084f2608c82c7e6fe0ec8cf0df3b74c589af2b4af36cefdf4","created":"2020-12-26T17:44:42.30707347Z","container":"47d47caf48c273448092c8bece2ec32b644d2fa104458f65165c7998f6b90d0f","container_config":{"Hostname":"5f0840e2add5","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","npm install -g ethercalc pm2 || true"],"Image":"cb4d76f9783d4d8084f2608c82c7e6fe0ec8cf0df3b74c589af2b4af36cefdf4","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"docker_version":"1.9.1","config":{"Hostname":"5f0840e2add5","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["node"],"Image":"cb4d76f9783d4d8084f2608c82c7e6fe0ec8cf0df3b74c589af2b4af36cefdf4","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"architecture":"amd64","os":"linux","Size":103312054}',
    },
    {
      v1Compatibility: '{"id":"cb4d76f9783d4d8084f2608c82c7e6fe0ec8cf0df3b74c589af2b4af36cefdf4","parent":"c25e18e94a91819a4e8f98c4b699a1f3df0f9b4a93597bfe5bca0722b186fb18","created":"2020-12-26T17:43:56.993267026Z","container":"5f0840e2add5ad65d5dcddcc8fb3037714267e63e08842727500581fc520363d","container_config":{"Hostname":"5f0840e2add5","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","useradd ethercalc --create-home"],"Image":"575f56fa5cfbe403545dd0679291fc0bdaa4b25f5f29453dbddb6cc09e9d43c0","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"docker_version":"1.9.1","config":{"Hostname":"5f0840e2add5","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["node"],"Image":"575f56fa5cfbe403545dd0679291fc0bdaa4b25f5f29453dbddb6cc09e9d43c0","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":[],"Labels":{}},"architecture":"amd64","os":"linux","Size":333982}',
    },
    {
      v1Compatibility: '{"architecture":"amd64","config":{"Hostname":"","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["node"],"Image":"sha256:b41c508f718fadc4862cfdb89d6fc49313a8107ec532c4c9383284a162ec7c9d","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":null,"Labels":null},"container":"18960504edc132929fdfb566e5ac71257f63cef1389428c0aa5e544bad0f3489","container_config":{"Hostname":"18960504edc1","Domainname":"","User":"","AttachStdin":false,"AttachStdout":false,"AttachStderr":false,"Tty":false,"OpenStdin":false,"StdinOnce":false,"Env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=15.5.0","YARN_VERSION=1.22.5"],"Cmd":["/bin/sh","-c","#(nop) ","CMD [\\"node\\"]"],"Image":"sha256:b41c508f718fadc4862cfdb89d6fc49313a8107ec532c4c9383284a162ec7c9d","Volumes":null,"WorkingDir":"","Entrypoint":["docker-entrypoint.sh"],"OnBuild":null,"Labels":{}},"created":"2020-12-23T20:25:59.156071601Z","docker_version":"19.03.12","id":"c25e18e94a91819a4e8f98c4b699a1f3df0f9b4a93597bfe5bca0722b186fb18","os":"linux","parent":"612ae752fc894d6f4032343ef7fd245727cef47b1d7d2b155549ef0208a7d68e","throwaway":true}',
    },
    {
      v1Compatibility: '{"id":"612ae752fc894d6f4032343ef7fd245727cef47b1d7d2b155549ef0208a7d68e","parent":"14061e5fa1106fbc3c991b60f263039c9741c3392a5624c0e1abbe4f57a0c557","created":"2020-12-23T20:25:58.96864162Z","container_config":{"Cmd":["/bin/sh -c #(nop)  ENTRYPOINT [\\"docker-entrypoint.sh\\"]"]},"throwaway":true}',
    },
    {
      v1Compatibility: '{"id":"14061e5fa1106fbc3c991b60f263039c9741c3392a5624c0e1abbe4f57a0c557","parent":"0cb69a0b39a9efbe59371decb64bdbaf51a9acb7c38a0e9a23a46b73aa1827b1","created":"2020-12-23T20:25:58.784997262Z","container_config":{"Cmd":["/bin/sh -c #(nop) COPY file:238737301d47304174e4d24f4def935b29b3069c03c72ae8de97d94624382fce in /usr/local/bin/ "]}}',
    },
    {
      v1Compatibility: '{"id":"0cb69a0b39a9efbe59371decb64bdbaf51a9acb7c38a0e9a23a46b73aa1827b1","parent":"a49649d38180d95f75b1c16b35be09426abd57c9bf5bb56f44a50a007dfd6016","created":"2020-12-23T20:25:58.555940237Z","container_config":{"Cmd":["/bin/sh -c set -ex   \\u0026\\u0026 for key in     6A010C5166006599AA17F08146C2130DFD2497F5   ; do     gpg --batch --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys \\"$key\\" ||     gpg --batch --keyserver hkp://ipv4.pool.sks-keyservers.net --recv-keys \\"$key\\" ||     gpg --batch --keyserver hkp://pgp.mit.edu:80 --recv-keys \\"$key\\" ;   done   \\u0026\\u0026 curl -fsSLO --compressed \\"https://yarnpkg.com/downloads/$YARN_VERSION/yarn-v$YARN_VERSION.tar.gz\\"   \\u0026\\u0026 curl -fsSLO --compressed \\"https://yarnpkg.com/downloads/$YARN_VERSION/yarn-v$YARN_VERSION.tar.gz.asc\\"   \\u0026\\u0026 gpg --batch --verify yarn-v$YARN_VERSION.tar.gz.asc yarn-v$YARN_VERSION.tar.gz   \\u0026\\u0026 mkdir -p /opt   \\u0026\\u0026 tar -xzf yarn-v$YARN_VERSION.tar.gz -C /opt/   \\u0026\\u0026 ln -s /opt/yarn-v$YARN_VERSION/bin/yarn /usr/local/bin/yarn   \\u0026\\u0026 ln -s /opt/yarn-v$YARN_VERSION/bin/yarnpkg /usr/local/bin/yarnpkg   \\u0026\\u0026 rm yarn-v$YARN_VERSION.tar.gz.asc yarn-v$YARN_VERSION.tar.gz   \\u0026\\u0026 yarn --version"]}}',
    },
    {
      v1Compatibility: '{"id":"a49649d38180d95f75b1c16b35be09426abd57c9bf5bb56f44a50a007dfd6016","parent":"a3fb7d45d1d4fa9b57a696baddfa249543a533834ccc85a58de614be8ce39e09","created":"2020-12-23T20:25:54.477738407Z","container_config":{"Cmd":["/bin/sh -c #(nop)  ENV YARN_VERSION=1.22.5"]},"throwaway":true}',
    },
    {
      v1Compatibility: "{\"id\":\"a3fb7d45d1d4fa9b57a696baddfa249543a533834ccc85a58de614be8ce39e09\",\"parent\":\"7f844edcff5f61da44da11552f2a14dc940dbe274730644b83cf855ab88682dc\",\"created\":\"2020-12-23T20:25:54.178160309Z\",\"container_config\":{\"Cmd\":[\"/bin/sh -c ARCH= \\u0026\\u0026 dpkgArch=\\\"$(dpkg --print-architecture)\\\"   \\u0026\\u0026 case \\\"${dpkgArch##*-}\\\" in     amd64) ARCH='x64';;     ppc64el) ARCH='ppc64le';;     s390x) ARCH='s390x';;     arm64) ARCH='arm64';;     armhf) ARCH='armv7l';;     i386) ARCH='x86';;     *) echo \\\"unsupported architecture\\\"; exit 1 ;;   esac   \\u0026\\u0026 set -ex   \\u0026\\u0026 for key in     4ED778F539E3634C779C87C6D7062848A1AB005C     94AE36675C464D64BAFA68DD7434390BDBE9B9C5     1C050899334244A8AF75E53792EF661D867B9DFA     71DCFD284A79C3B38668286BC97EC7A07EDE3FC1     8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600     C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8     C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C     DD8F2338BAE7501E3DD5AC78C273792F7D83545D     A48C2BEE680E841632CD4E44F07496B3EB3C1762     108F52B48DB57BB0CC439B2997B01419BD92F80A     B9E2F5981AA6E0CD28160D9FF13993A75599653C   ; do     gpg --batch --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys \\\"$key\\\" ||     gpg --batch --keyserver hkp://ipv4.pool.sks-keyservers.net --recv-keys \\\"$key\\\" ||     gpg --batch --keyserver hkp://pgp.mit.edu:80 --recv-keys \\\"$key\\\" ;   done   \\u0026\\u0026 curl -fsSLO --compressed \\\"https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz\\\"   \\u0026\\u0026 curl -fsSLO --compressed \\\"https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt.asc\\\"   \\u0026\\u0026 gpg --batch --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc   \\u0026\\u0026 grep \\\" node-v$NODE_VERSION-linux-$ARCH.tar.xz\\\\$\\\" SHASUMS256.txt | sha256sum -c -   \\u0026\\u0026 tar -xJf \\\"node-v$NODE_VERSION-linux-$ARCH.tar.xz\\\" -C /usr/local --strip-components=1 --no-same-owner   \\u0026\\u0026 rm \\\"node-v$NODE_VERSION-linux-$ARCH.tar.xz\\\" SHASUMS256.txt.asc SHASUMS256.txt   \\u0026\\u0026 ln -s /usr/local/bin/node /usr/local/bin/nodejs   \\u0026\\u0026 node --version   \\u0026\\u0026 npm --version\"]}}",
    },
    {
      v1Compatibility: '{"id":"7f844edcff5f61da44da11552f2a14dc940dbe274730644b83cf855ab88682dc","parent":"0c971729eb7ab4409655366fb28abfcdcd581177c60cee51de2aab2f6e9b54a1","created":"2020-12-23T20:25:46.527272635Z","container_config":{"Cmd":["/bin/sh -c #(nop)  ENV NODE_VERSION=15.5.0"]},"throwaway":true}',
    },
    {
      v1Compatibility: '{"id":"0c971729eb7ab4409655366fb28abfcdcd581177c60cee51de2aab2f6e9b54a1","parent":"a45e4aee6f3951e67600fdd3b713cbcae9168e43c200f9b2bad785437852f18b","created":"2020-12-18T02:47:25.031252672Z","container_config":{"Cmd":["/bin/sh -c groupadd --gid 1000 node   \\u0026\\u0026 useradd --uid 1000 --gid node --shell /bin/bash --create-home node"]}}',
    },
    {
      v1Compatibility: "{\"id\":\"a45e4aee6f3951e67600fdd3b713cbcae9168e43c200f9b2bad785437852f18b\",\"parent\":\"c512f912a5e580315736561d7b6b097493389ee4a3a34b909a8e30a703aeb55c\",\"created\":\"2020-12-17T17:02:40.727565679Z\",\"container_config\":{\"Cmd\":[\"/bin/sh -c set -ex; \\tapt-get update; \\tapt-get install -y --no-install-recommends \\t\\tautoconf \\t\\tautomake \\t\\tbzip2 \\t\\tdpkg-dev \\t\\tfile \\t\\tg++ \\t\\tgcc \\t\\timagemagick \\t\\tlibbz2-dev \\t\\tlibc6-dev \\t\\tlibcurl4-openssl-dev \\t\\tlibdb-dev \\t\\tlibevent-dev \\t\\tlibffi-dev \\t\\tlibgdbm-dev \\t\\tlibglib2.0-dev \\t\\tlibgmp-dev \\t\\tlibjpeg-dev \\t\\tlibkrb5-dev \\t\\tliblzma-dev \\t\\tlibmagickcore-dev \\t\\tlibmagickwand-dev \\t\\tlibmaxminddb-dev \\t\\tlibncurses5-dev \\t\\tlibncursesw5-dev \\t\\tlibpng-dev \\t\\tlibpq-dev \\t\\tlibreadline-dev \\t\\tlibsqlite3-dev \\t\\tlibssl-dev \\t\\tlibtool \\t\\tlibwebp-dev \\t\\tlibxml2-dev \\t\\tlibxslt-dev \\t\\tlibyaml-dev \\t\\tmake \\t\\tpatch \\t\\tunzip \\t\\txz-utils \\t\\tzlib1g-dev \\t\\t\\t\\t$( \\t\\t\\tif apt-cache show 'default-libmysqlclient-dev' 2\\u003e/dev/null | grep -q '^Version:'; then \\t\\t\\t\\techo 'default-libmysqlclient-dev'; \\t\\t\\telse \\t\\t\\t\\techo 'libmysqlclient-dev'; \\t\\t\\tfi \\t\\t) \\t; \\trm -rf /var/lib/apt/lists/*\"]}}",
    },
    {
      v1Compatibility: '{"id":"c512f912a5e580315736561d7b6b097493389ee4a3a34b909a8e30a703aeb55c","parent":"5c403d7b89c8ae69189a42baa8d26c1a3ec2cd1d8806824549a0b517349cb032","created":"2020-12-17T17:01:43.674842485Z","container_config":{"Cmd":["/bin/sh -c apt-get update \\u0026\\u0026 apt-get install -y --no-install-recommends \\t\\tbzr \\t\\tgit \\t\\tmercurial \\t\\topenssh-client \\t\\tsubversion \\t\\t\\t\\tprocps \\t\\u0026\\u0026 rm -rf /var/lib/apt/lists/*"]}}',
    },
    {
      v1Compatibility: '{"id":"5c403d7b89c8ae69189a42baa8d26c1a3ec2cd1d8806824549a0b517349cb032","parent":"b284aebf865048e18fee9e2fe6d95900a23796b488b677cca3c51379bd69941c","created":"2020-12-17T17:01:19.973409764Z","container_config":{"Cmd":["/bin/sh -c set -ex; \\tif ! command -v gpg \\u003e /dev/null; then \\t\\tapt-get update; \\t\\tapt-get install -y --no-install-recommends \\t\\t\\tgnupg \\t\\t\\tdirmngr \\t\\t; \\t\\trm -rf /var/lib/apt/lists/*; \\tfi"]}}',
    },
    {
      v1Compatibility: '{"id":"b284aebf865048e18fee9e2fe6d95900a23796b488b677cca3c51379bd69941c","parent":"b4a5442a11b5f969a17a2a2f802c3cbee19dd5fe791c1e33e1d304db2dc1c326","created":"2020-12-17T17:01:14.607850538Z","container_config":{"Cmd":["/bin/sh -c set -eux; \\tapt-get update; \\tapt-get install -y --no-install-recommends \\t\\tca-certificates \\t\\tcurl \\t\\tnetbase \\t\\twget \\t; \\trm -rf /var/lib/apt/lists/*"]}}',
    },
    {
      v1Compatibility: '{"id":"b4a5442a11b5f969a17a2a2f802c3cbee19dd5fe791c1e33e1d304db2dc1c326","parent":"56b0fc4faa4c5f35dcd1c34c1bd916fd24c9978c3435e5b69d8b87649da9b8d8","created":"2020-12-11T02:08:43.491641669Z","container_config":{"Cmd":["/bin/sh -c #(nop)  CMD [\\"bash\\"]"]},"throwaway":true}',
    },
    {
      v1Compatibility: '{"id":"56b0fc4faa4c5f35dcd1c34c1bd916fd24c9978c3435e5b69d8b87649da9b8d8","created":"2020-12-11T02:08:43.162307581Z","container_config":{"Cmd":["/bin/sh -c #(nop) ADD file:c3a852d22b3aac160ba028af69d56b491a2a9419f32a459c4b9b2cbd9129c004 in / "]}}',
    },
  ],
  signatures: [
    {
      header: {
        jwk: {
          crv: 'P-256',
          kid: 'RZIN:74Z6:2E67:JI5V:WTS7:YKYO:VSPS:5LAN:5TIJ:5XMT:XMTR:JXER',
          kty: 'EC',
          x: 'idbGw_f9uaBXF5TgNdeVh45554JcjOs0Djw-f8d4HKE',
          y: '9vCe9laREBmBKUZPO0PbY9AG539gsBee4OBKkRW41jA',
        },
        alg: 'ES256',
      },
      signature: 'rNzaN5wkc--3ivqPmTRIu6LoEpEA-XkXwB4iWwa2QNfV6VpfCSdstbir6QgdColndLvhiImJWu0j22zYV99G8g',
      protected: 'eyJmb3JtYXRMZW5ndGgiOjIwOTQzLCJmb3JtYXRUYWlsIjoiQ24wIiwidGltZSI6IjIwMjQtMDctMTFUMDY6MzQ6MTRaIn0',
    },
  ],
};
/* eslint-enable max-len, vue/max-len, no-template-curly-in-string */

module.exports = {
  ociIndex,
  ociIndexUnsupported,
  ociManifestAmd64,
  ociManifestArm64,
  distributionManifestList,
  distributionManifestListUnsupported,
  distributionManifestAmd64,
  distributionManifestArm64,
  imageConfigAmd64,
  imageConfigArm64,
  oversizeDistributionManifestAmd64,
  oversizeOciManifestAmd64,
  schemaV1Amd64,
};
