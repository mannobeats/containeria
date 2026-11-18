//! Reading an ext4 superblock, to tell an empty data disk from a formatted one and to notice that
//! the disk grew.

/// How much of the start of a disk [`Superblock::read`] needs.
pub const HEADER_LEN: usize = 2048;

const SUPERBLOCK: usize = 1024;
const MAGIC: [u8; 2] = [0x53, 0xEF];
const FEATURE_64BIT: u32 = 0x80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Superblock {
    /// The size of the filesystem in bytes, which is less than the disk's after the disk grew.
    pub bytes: u64,
}

impl Superblock {
    /// The ext4 filesystem starting at `header`, or `None` when there is none, as on a new disk.
    #[must_use]
    pub fn read(header: &[u8]) -> Option<Self> {
        let block = header.get(SUPERBLOCK..HEADER_LEN)?;
        if block.get(56..58)? != MAGIC {
            return None;
        }
        let low = u64::from(u32_at(block, 4)?);
        let high = if u32_at(block, 96)? & FEATURE_64BIT == 0 { 0 } else { u32_at(block, 336)? };
        let block_size = 1024_u64.checked_shl(u32_at(block, 24)?)?;
        Some(Self { bytes: ((u64::from(high) << 32) | low).checked_mul(block_size)? })
    }
}

fn u32_at(block: &[u8], offset: usize) -> Option<u32> {
    block.get(offset..offset + 4)?.try_into().ok().map(u32::from_le_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(blocks: u64, log_block_size: u32, wide: bool) -> Vec<u8> {
        let mut header = vec![0; HEADER_LEN];
        let block = &mut header[SUPERBLOCK..];
        block[56..58].copy_from_slice(&MAGIC);
        block[4..8].copy_from_slice(&u32::try_from(blocks & 0xFFFF_FFFF).unwrap().to_le_bytes());
        block[24..28].copy_from_slice(&log_block_size.to_le_bytes());
        if wide {
            block[96..100].copy_from_slice(&FEATURE_64BIT.to_le_bytes());
            block[336..340].copy_from_slice(&u32::try_from(blocks >> 32).unwrap().to_le_bytes());
        }
        header
    }

    #[test]
    fn a_blank_disk_has_no_filesystem() {
        assert_eq!(Superblock::read(&[0; HEADER_LEN]), None);
    }

    #[test]
    fn a_short_read_has_no_filesystem() {
        assert_eq!(Superblock::read(&[0; 512]), None);
    }

    #[test]
    fn reads_the_size_of_a_filesystem() {
        let found = Superblock::read(&header(26_214_400, 2, false)).unwrap();
        assert_eq!(found.bytes, 100 << 30);
    }

    #[test]
    fn reads_sizes_past_sixteen_terabytes() {
        let found = Superblock::read(&header(1 << 33, 2, true)).unwrap();
        assert_eq!(found.bytes, 1 << 45);
    }
}
